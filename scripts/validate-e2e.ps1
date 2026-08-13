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

# Les libellés sont accentués : sans cela, la sortie est illisible sur une console en page de code héritée.
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
Step 'Prérequis'
$daemon = docker version --format '{{.Server.Version}}' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output '  Le daemon Docker ne répond pas. Démarrez Docker Desktop puis relancez.'
    exit 1
}
Show 'daemon Docker' $daemon

$testInstances = @(docker compose -f docker-compose.test.yml ps --format '{{.Service}}:{{.State}}' 2>&1)
# Parenthèses indispensables : « $tableau -notmatch » renvoie les éléments non concordants,
# ce qui serait toujours vrai dès qu'un autre service est listé.
if (-not ($testInstances -match 'pg-full:running')) {
    Write-Output '  Instances de test absentes. Lancez : docker compose -f docker-compose.test.yml up -d'
    exit 1
}
Show 'instances de test' ($testInstances -join ' ')

# --- Jeu de données ----------------------------------------------------------
if (-not $SkipSeed) {
    Step 'Alimentation de l''instance de test'
    Get-Content (Join-Path $PSScriptRoot 'seed-test-data.sql') -Raw |
        docker exec -i pg-advisor-pg-full-1 psql -U postgres -d shop 2>&1 |
        Select-String -Pattern 'ERROR|ERREUR' |
        Select-Object -First 5 |
        ForEach-Object { Show 'erreur SQL' $_.Line }
    Show 'jeu de données appliqué' 'oui'
}

# --- Image et conteneur ------------------------------------------------------
Step 'Construction de l''image et démarrage du conteneur'
docker compose up -d --build 2>&1 | Select-Object -Last 5 | ForEach-Object { Show 'compose' $_ }

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-RestMethod 'http://127.0.0.1:8080/api/health' -TimeoutSec 5 | Out-Null
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 3 }
}
Show 'API disponible' $ready
if (-not $ready) {
    docker compose logs --tail 40 pg-advisor
    exit 1
}

# --- Authentification --------------------------------------------------------
Step 'Authentification'
$logs = docker compose logs pg-advisor 2>&1 | Out-String
$match = [regex]::Match($logs, 'mot de passe : (\S+)')
if (-not $match.Success) {
    Write-Output '  Mot de passe de bootstrap introuvable dans les journaux.'
    Write-Output '  Si le conteneur a déjà servi, réutilisez le mot de passe existant ou supprimez le volume.'
    exit 1
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-RestMethod 'http://127.0.0.1:8080/api/auth/login' -Method Post `
    -Body (@{ username = 'admin'; password = $match.Groups[1].Value } | ConvertTo-Json) `
    -ContentType 'application/json' -WebSession $session -TimeoutSec 15
Show 'compte' ($login.username + ' (' + $login.role + ')')
Show 'changement de mot de passe imposé' $login.mustChangePassword

# --- Test de connexion -------------------------------------------------------
# host.docker.internal : les PostgreSQL de test tournent dans une autre stack compose.
$targets = @(
    @{ Name = 'Production'; Port = 55432; Database = 'shop' },
    @{ Name = 'Staging'; Port = 55433; Database = 'billing' }
)

Step 'Test de connexion et détection des capacités'
foreach ($target in $targets) {
    $probe = @{
        host = 'host.docker.internal'; port = $target.Port; database = $target.Database
        username = 'postgres'; password = 'advisor-test'; sslMode = 'Disable'
    } | ConvertTo-Json

    $result = Invoke-RestMethod 'http://127.0.0.1:8080/api/connections/test' -Method Post `
        -Body $probe -ContentType 'application/json' -WebSession $session -TimeoutSec 30

    Show $target.Name ('succès=' + $result.success + ' PostgreSQL ' + $result.serverVersion +
        ' TimescaleDB=' + $result.timescaleVersion + ' lecture seule=' + $result.readOnlyEnforced)
    if ($result.error) { Show '  erreur' $result.error }

    $available = ($result.capabilities | Where-Object { $_.available })
    $missing = ($result.capabilities | Where-Object { -not $_.available })
    Show '  capacités' ($available.Count.ToString() + ' disponibles, ' + $missing.Count + ' absentes')
    Show '  absentes' (($missing | ForEach-Object { $_.name }) -join ', ')
    foreach ($warning in $result.warnings) { Show '  avertissement' $warning }
}

# --- Enregistrement ----------------------------------------------------------
Step 'Enregistrement des instances'
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
        Show $target.Name ('enregistrée, id=' + $created.id)
    } catch {
        # Une instance du même nom existe déjà : on récupère son identifiant.
        $existing = (Invoke-RestMethod 'http://127.0.0.1:8080/api/connections' -WebSession $session) |
            Where-Object { $_.name -eq $target.Name }
        if ($existing) {
            $ids[$target.Name] = $existing.id
            Show $target.Name ('déjà enregistrée, id=' + $existing.id)
        } else {
            Show ('ERREUR ' + $target.Name) $_
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
    Show 'webhook enregistré' $webhook.key

    $test = Invoke-RestMethod ('http://127.0.0.1:8080/api/notifications/' + $webhook.id + '/test') `
        -Method Post -WebSession $session -TimeoutSec 20
    Show 'test d''envoi' ('succès=' + $test.success + ' HTTP ' + $test.statusCode)
} catch {
    Show 'webhook' 'déjà configuré ou en erreur'
}

# --- Analyse -----------------------------------------------------------------
Step 'Attente de la première analyse complète'
$deadline = (Get-Date).AddMinutes($AnalysisTimeoutMinutes)
$dashboard = $null

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    try {
        $dashboard = Invoke-RestMethod 'http://127.0.0.1:8080/api/dashboard' -WebSession $session -TimeoutSec 20
    } catch { continue }

    $collected = ($dashboard.instances | Where-Object { $_.lastCollectedAt }).Count
    Show 'progression' ('instances collectées=' + $collected + '/' + $targets.Count +
        ' findings actifs=' + $dashboard.summary.active + ' santé=' + $dashboard.globalHealth)

    if ($dashboard.summary.active -gt 0 -and $collected -eq $targets.Count) { break }
}

# --- Résultat ----------------------------------------------------------------
Step 'Résultat'
if ($dashboard) {
    Show 'santé globale' ($dashboard.globalHealth.ToString() + '/100')
    Show 'findings actifs' ('critiques=' + $dashboard.summary.critical +
        ' avertissements=' + $dashboard.summary.warning + ' informations=' + $dashboard.summary.info)
    Show 'règles' ($dashboard.rules.total.ToString() + ' chargées, ' +
        $dashboard.rules.errors.Count + ' en erreur')
    foreach ($ruleError in $dashboard.rules.errors) {
        Show '  règle refusée' ($ruleError.ruleId + ' : ' + $ruleError.message)
    }

    foreach ($instance in $dashboard.instances) {
        $timescale = $instance.timescaleVersion ? (' / TimescaleDB ' + $instance.timescaleVersion) : ''
        Write-Output ''
        Write-Output ('  --- ' + $instance.name + ' (PostgreSQL ' + $instance.serverVersion + $timescale + ')')
        Show '  état' $instance.collectionState
        if ($instance.lastError) { Show '  erreur' $instance.lastError }
        Show '  santé' ($instance.health.global.ToString() + '/100')
        if ($instance.metrics) {
            Show '  activité' ('connexions=' + $instance.metrics.connections + '/' +
                $instance.metrics.maxConnections +
                ' cache=' + [math]::Round($instance.metrics.cacheHitRatio * 100, 1) + '%' +
                ' taille=' + [math]::Round($instance.metrics.databaseSizeBytes / 1MB, 1) + ' Mio')
        }
        $categories = $instance.health.categories.PSObject.Properties | Sort-Object { $_.Value }
        Show '  catégories notées' (($categories | ForEach-Object { $_.Name + '=' + $_.Value }) -join ' ')
    }
}

Step 'Recommandations détectées'
try {
    $page = Invoke-RestMethod 'http://127.0.0.1:8080/api/findings?status=active&pageSize=60' `
        -WebSession $session -TimeoutSec 20
    Show 'total' $page.total
    foreach ($finding in $page.items) {
        Write-Output ('  [' + $finding.severity.PadRight(8) + '] ' + $finding.connectionName +
            ' | ' + $finding.ruleId)
        Write-Output ('             ' + $finding.message)
    }
} catch { Show 'ERREUR' $_ }

Step 'Notifications'
try {
    $history = Invoke-RestMethod 'http://127.0.0.1:8080/api/notifications/history' -WebSession $session -TimeoutSec 15
    Show 'historique' ($history.Count.ToString() + ' entrées, ' +
        ($history | Where-Object { $_.success }).Count + ' réussies')
    $received = docker logs pg-advisor-webhook-echo-1 2>&1 | Select-String -Pattern 'new_finding' |
        Measure-Object -Line
    Show 'requêtes vues par le récepteur' $received.Lines
} catch { Show 'ERREUR' $_ }

# --- Aperçus de règles -------------------------------------------------------
# Chaque règle est exécutée à blanc sur les deux instances : c'est la seule façon de vérifier
# que son SQL est valide, que ses colonnes existent et que ses prérequis la filtrent bien.
$allRules = Invoke-RestMethod 'http://127.0.0.1:8080/api/rules' -WebSession $session -TimeoutSec 20

foreach ($target in $targets) {
    Step ('Exécution à blanc des ' + $allRules.Count + ' règles sur ' + $target.Name)
    $failures = 0
    $skipped = 0

    foreach ($rule in $allRules) {
        try {
            $dry = Invoke-RestMethod ('http://127.0.0.1:8080/api/rules/' + $rule.id + '/dry-run') -Method Post `
                -Body (@{ connectionId = $ids[$target.Name] } | ConvertTo-Json) `
                -ContentType 'application/json' -WebSession $session -TimeoutSec 120

            if ($dry.error) {
                $failures++
                Show $rule.id ('ERREUR SQL : ' + $dry.error)
            } elseif ($dry.skipReason) {
                $skipped++
                Show $rule.id ('ignorée — ' + $dry.skipReason)
            } else {
                Show $rule.id ('lignes=' + $dry.rowCount + ' findings=' + $dry.findings.Count +
                    ' en ' + [math]::Round($dry.durationMs) + ' ms')
            }
        } catch {
            $failures++
            Show $rule.id ('appel en échec : ' + $_)
        }
    }

    Write-Output ''
    Show 'bilan' ($allRules.Count.ToString() + ' règles, ' + $skipped + ' ignorées faute de capacité, ' +
        $failures + ' en erreur SQL')
}

# --- Zero-touch --------------------------------------------------------------
Step 'Vérification du principe zero-touch'
$extensions = docker exec pg-advisor-pg-full-1 psql -U postgres -d shop -At `
    -c "SELECT string_agg(extname, ', ' ORDER BY extname) FROM pg_extension" 2>&1
Show 'extensions présentes' $extensions
Show 'attendu' 'plpgsql, timescaledb, pg_stat_statements (créées par le jeu de test uniquement)'

$settings = docker exec pg-advisor-pg-full-1 psql -U postgres -d shop -At `
    -c "SELECT count(*) FROM pg_settings WHERE source NOT IN ('default', 'override', 'command line', 'configuration file', 'environment variable', 'client')" 2>&1
Show 'paramètres modifiés hors configuration' $settings

Step 'Journaux du conteneur'
docker compose logs pg-advisor 2>&1 |
    Select-String -Pattern 'warn|fail|Unhandled|Exception' |
    Select-Object -Last 12 |
    ForEach-Object { Write-Output ('  ' + $_.Line) }

Write-Output ''
Write-Output 'Validation terminée. Interface : http://localhost:8080'
