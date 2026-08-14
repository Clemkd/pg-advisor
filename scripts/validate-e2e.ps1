<#
.SYNOPSIS
    Validation de bout en bout : image Docker unique, connexion à deux PostgreSQL réels,
    analyse automatique, findings, health score, webhook.

.DESCRIPTION
    Le script suit le parcours décrit dans le descriptif projet :
    docker compose up -> login -> ajout des instances -> connexion read-only -> analyse
    automatique -> health score -> recommandations -> notification webhook.

    Prérequis : Docker démarré, et les instances de test lancées :
        docker compose -f docker-compose.test.yml up -d

.EXAMPLE
    pwsh ./scripts/validate-e2e.ps1
#>

[CmdletBinding()]
param(
    # Durée maximale d'attente de la première analyse complète.
    [int] $AnalysisTimeoutMinutes = 8,

    # Alimente l'instance de test avec un jeu de données qui déclenche des règles.
    [switch] $SkipSeed
)

$ErrorActionPreference = 'Continue'
$repository = Split-Path -Parent $PSScriptRoot
Set-Location $repository

# Les textes renvoyés par l'API sont en UTF-8 : sans cela, la sortie est illisible sur une
# console en page de code héritée.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 127.0.0.1 plutôt que localhost : ce dernier résout d'abord en ::1, et le mappage IPv6 de
# Docker Desktop n'aboutit pas, ce qui ferait expirer chaque appel avant le repli en IPv4.
$api = 'http://127.0.0.1:8080'

function Step([string]$title) {
    Write-Output ''
    Write-Output ('=== ' + $title + ' ===')
}

function Show([string]$label, $value) {
    Write-Output ('  ' + $label.PadRight(38) + ' ' + $value)
}

# --- Prérequis ---------------------------------------------------------------
Step 'Prerequisites'
$daemon = docker version --format '{{.Server.Version}}' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output '  The Docker daemon is not responding. Start Docker Desktop, then run again.'
    exit 1
}
Show 'Docker daemon' $daemon

$testInstances = @(docker compose -f docker-compose.test.yml ps --format '{{.Service}}:{{.State}}' 2>&1)
# Parenthèses indispensables : « $tableau -notmatch » renvoie les éléments non concordants,
# ce qui serait toujours vrai dès qu'un autre service est listé.
if (-not ($testInstances -match 'pg-full:running')) {
    Write-Output '  Test instances are missing. Run: docker compose -f docker-compose.test.yml up -d'
    exit 1
}
Show 'test instances' ($testInstances -join ' ')

# --- Jeu de données ----------------------------------------------------------
if (-not $SkipSeed) {
    Step 'Seeding the test instance'
    Get-Content (Join-Path $PSScriptRoot 'seed-test-data.sql') -Raw |
        docker exec -i pg-advisor-pg-full-1 psql -U postgres -d shop 2>&1 |
        Select-String -Pattern 'ERROR|ERREUR' |
        Select-Object -First 5 |
        ForEach-Object { Show 'SQL error' $_.Line }
    Show 'seed data applied' 'yes'
}

# --- Image et conteneur ------------------------------------------------------
Step 'Building the image and starting the container'
docker compose up -d --build 2>&1 | Select-Object -Last 5 | ForEach-Object { Show 'compose' $_ }

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-RestMethod 'http://127.0.0.1:8080/api/health' -TimeoutSec 5 | Out-Null
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 3 }
}
Show 'API available' $ready
if (-not $ready) {
    docker compose logs --tail 40 pg-advisor
    exit 1
}

# --- Authentification --------------------------------------------------------
Step 'Authentication'
$logs = docker compose logs pg-advisor 2>&1 | Out-String
$match = [regex]::Match($logs, 'password: (\S+)')
if (-not $match.Success) {
    Write-Output '  Bootstrap password not found in the logs.'
    Write-Output '  If the container has already been used, reuse the existing password or delete the volume.'
    exit 1
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-RestMethod 'http://127.0.0.1:8080/api/auth/login' -Method Post `
    -Body (@{ username = 'admin'; password = $match.Groups[1].Value } | ConvertTo-Json) `
    -ContentType 'application/json' -WebSession $session -TimeoutSec 15
Show 'account' ($login.username + ' (' + $login.role + ')')
Show 'password change required' $login.mustChangePassword

# --- Test de connexion -------------------------------------------------------
# host.docker.internal : les PostgreSQL de test tournent dans une autre stack compose.
$targets = @(
    @{ Name = 'Production'; Port = 55432; Database = 'shop' },
    @{ Name = 'Staging'; Port = 55433; Database = 'billing' }
)

Step 'Connection test and capability detection'
foreach ($target in $targets) {
    $probe = @{
        host = 'host.docker.internal'; port = $target.Port; database = $target.Database
        username = 'postgres'; password = 'advisor-test'; sslMode = 'Disable'
    } | ConvertTo-Json

    $result = Invoke-RestMethod 'http://127.0.0.1:8080/api/connections/test' -Method Post `
        -Body $probe -ContentType 'application/json' -WebSession $session -TimeoutSec 30

    Show $target.Name ('success=' + $result.success + ' PostgreSQL ' + $result.serverVersion +
        ' TimescaleDB=' + $result.timescaleVersion + ' read only=' + $result.readOnlyEnforced)
    if ($result.error) { Show '  error' $result.error }

    $available = ($result.capabilities | Where-Object { $_.available })
    $missing = ($result.capabilities | Where-Object { -not $_.available })
    Show '  capabilities' ($available.Count.ToString() + ' available, ' + $missing.Count + ' missing')
    Show '  missing' (($missing | ForEach-Object { $_.name }) -join ', ')
    foreach ($warning in $result.warnings) { Show '  warning' $warning }
}

# --- Enregistrement ----------------------------------------------------------
Step 'Registering the instances'
$ids = @{}
foreach ($target in $targets) {
    $payload = @{
        name = $target.Name; host = 'host.docker.internal'; port = $target.Port
        database = $target.Database; username = 'postgres'; password = 'advisor-test'
        sslMode = 'Disable'; collectionIntervalSeconds = 10; enabled = $true
    } | ConvertTo-Json

    try {
        $created = Invoke-RestMethod 'http://127.0.0.1:8080/api/connections' -Method Post `
            -Body $payload -ContentType 'application/json' -WebSession $session -TimeoutSec 20
        $ids[$target.Name] = $created.id
        Show $target.Name ('registered, id=' + $created.id)
    } catch {
        # Une instance du même nom existe déjà : on récupère son identifiant.
        $existing = (Invoke-RestMethod 'http://127.0.0.1:8080/api/connections' -WebSession $session) |
            Where-Object { $_.name -eq $target.Name }
        if ($existing) {
            $ids[$target.Name] = $existing.id
            Show $target.Name ('already registered, id=' + $existing.id)
        } else {
            Show ('ERROR ' + $target.Name) $_
        }
    }
}

# --- Webhook -----------------------------------------------------------------
Step 'Webhook'
try {
    $hook = @{
        key = 'operations'; url = 'http://host.docker.internal:58888/pg-advisor'
        enabled = $true; minimumSeverity = 'info'; events = @('new_finding', 'finding_resolved')
    } | ConvertTo-Json

    $webhook = Invoke-RestMethod 'http://127.0.0.1:8080/api/notifications' -Method Post `
        -Body $hook -ContentType 'application/json' -WebSession $session -TimeoutSec 15
    Show 'webhook registered' $webhook.key

    $test = Invoke-RestMethod ('http://127.0.0.1:8080/api/notifications/' + $webhook.id + '/test') `
        -Method Post -WebSession $session -TimeoutSec 20
    Show 'test delivery' ('success=' + $test.success + ' HTTP ' + $test.statusCode)
} catch {
    Show 'webhook' 'already configured or failing'
}

# --- Analyse -----------------------------------------------------------------
Step 'Waiting for the first full analysis'
$deadline = (Get-Date).AddMinutes($AnalysisTimeoutMinutes)
$dashboard = $null

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    try {
        $dashboard = Invoke-RestMethod 'http://127.0.0.1:8080/api/dashboard' -WebSession $session -TimeoutSec 20
    } catch { continue }

    $collected = ($dashboard.instances | Where-Object { $_.lastCollectedAt }).Count
    Show 'progress' ('instances collected=' + $collected + '/' + $targets.Count +
        ' active findings=' + $dashboard.summary.active + ' health=' + $dashboard.globalHealth)

    if ($dashboard.summary.active -gt 0 -and $collected -eq $targets.Count) { break }
}

# --- Résultat ----------------------------------------------------------------
Step 'Result'
if ($dashboard) {
    Show 'global health' ($dashboard.globalHealth.ToString() + '/100')
    Show 'active findings' ('critical=' + $dashboard.summary.critical +
        ' warnings=' + $dashboard.summary.warning + ' info=' + $dashboard.summary.info)
    Show 'rules' ($dashboard.rules.total.ToString() + ' loaded, ' +
        $dashboard.rules.errors.Count + ' in error')
    foreach ($ruleError in $dashboard.rules.errors) {
        Show '  rejected rule' ($ruleError.ruleId + ': ' + $ruleError.message)
    }

    foreach ($instance in $dashboard.instances) {
        $timescale = $instance.timescaleVersion ? (' / TimescaleDB ' + $instance.timescaleVersion) : ''
        Write-Output ''
        Write-Output ('  --- ' + $instance.name + ' (PostgreSQL ' + $instance.serverVersion + $timescale + ')')
        Show '  state' $instance.collectionState
        if ($instance.lastError) { Show '  error' $instance.lastError }
        Show '  health' ($instance.health.global.ToString() + '/100')
        if ($instance.metrics) {
            Show '  activity' ('connections=' + $instance.metrics.connections + '/' +
                $instance.metrics.maxConnections +
                ' cache=' + [math]::Round($instance.metrics.cacheHitRatio * 100, 1) + '%' +
                ' size=' + [math]::Round($instance.metrics.databaseSizeBytes / 1MB, 1) + ' MiB')
        }
        $categories = $instance.health.categories.PSObject.Properties | Sort-Object { $_.Value }
        Show '  scored categories' (($categories | ForEach-Object { $_.Name + '=' + $_.Value }) -join ' ')
    }
}

Step 'Detected recommendations'
try {
    $page = Invoke-RestMethod 'http://127.0.0.1:8080/api/findings?status=active&pageSize=60' `
        -WebSession $session -TimeoutSec 20
    Show 'total' $page.total
    foreach ($finding in $page.items) {
        Write-Output ('  [' + $finding.severity.PadRight(8) + '] ' + $finding.connectionName +
            ' | ' + $finding.ruleId)
        Write-Output ('             ' + $finding.message)
    }
} catch { Show 'ERROR' $_ }

Step 'Notifications'
try {
    $history = Invoke-RestMethod 'http://127.0.0.1:8080/api/notifications/history' -WebSession $session -TimeoutSec 15
    Show 'history' ($history.Count.ToString() + ' entries, ' +
        ($history | Where-Object { $_.success }).Count + ' succeeded')
    $received = docker logs pg-advisor-webhook-echo-1 2>&1 | Select-String -Pattern 'new_finding' |
        Measure-Object -Line
    Show 'requests seen by the receiver' $received.Lines
} catch { Show 'ERROR' $_ }

# --- Aperçus de règles -------------------------------------------------------
# Chaque règle est exécutée à blanc sur les deux instances : c'est la seule façon de vérifier
# que son SQL est valide, que ses colonnes existent et que ses prérequis la filtrent bien.
$allRules = Invoke-RestMethod 'http://127.0.0.1:8080/api/rules' -WebSession $session -TimeoutSec 20

foreach ($target in $targets) {
    Step ('Dry run of the ' + $allRules.Count + ' rules on ' + $target.Name)
    $failures = 0
    $skipped = 0

    foreach ($rule in $allRules) {
        try {
            $dry = Invoke-RestMethod ('http://127.0.0.1:8080/api/rules/' + $rule.id + '/dry-run') -Method Post `
                -Body (@{ connectionId = $ids[$target.Name] } | ConvertTo-Json) `
                -ContentType 'application/json' -WebSession $session -TimeoutSec 120

            if ($dry.error) {
                $failures++
                Show $rule.id ('SQL ERROR: ' + $dry.error)
            } elseif ($dry.skipReason) {
                $skipped++
                Show $rule.id ('skipped - ' + $dry.skipReason)
            } else {
                Show $rule.id ('rows=' + $dry.rowCount + ' findings=' + $dry.findings.Count +
                    ' in ' + [math]::Round($dry.durationMs) + ' ms')
            }
        } catch {
            $failures++
            Show $rule.id ('call failed: ' + $_)
        }
    }

    Write-Output ''
    Show 'summary' ($allRules.Count.ToString() + ' rules, ' + $skipped + ' skipped for missing capability, ' +
        $failures + ' with SQL errors')
}

# --- Zero-touch --------------------------------------------------------------
Step 'Zero-touch verification'
$extensions = docker exec pg-advisor-pg-full-1 psql -U postgres -d shop -At `
    -c "SELECT string_agg(extname, ', ' ORDER BY extname) FROM pg_extension" 2>&1
Show 'extensions present' $extensions
Show 'expected' 'plpgsql, timescaledb, pg_stat_statements (created by the test seed only)'

$settings = docker exec pg-advisor-pg-full-1 psql -U postgres -d shop -At `
    -c "SELECT count(*) FROM pg_settings WHERE source NOT IN ('default', 'override', 'command line', 'configuration file', 'environment variable', 'client')" 2>&1
Show 'settings changed outside configuration' $settings

Step 'Container logs'
docker compose logs pg-advisor 2>&1 |
    Select-String -Pattern 'warn|fail|Unhandled|Exception' |
    Select-Object -Last 12 |
    ForEach-Object { Write-Output ('  ' + $_.Line) }

Write-Output ''
Write-Output 'Validation complete. UI: http://localhost:8080'
