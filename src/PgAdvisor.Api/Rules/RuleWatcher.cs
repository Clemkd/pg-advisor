using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace PgAdvisor.Api.Rules;

/// <summary>
/// Hot reload des règles. Deux mécanismes complémentaires :
/// un FileSystemWatcher pour réagir en moins d'une seconde, et une empreinte relevée
/// périodiquement car les notifications inotify traversent mal les montages Docker.
/// </summary>
public sealed class RuleWatcher(
    RuleStore store,
    IOptions<AdvisorOptions> options,
    ILogger<RuleWatcher> logger) : BackgroundService
{
    private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(10);

    private readonly AdvisorOptions _options = options.Value;
    private readonly Lock _gate = new();

    private DateTimeOffset? _pendingSince;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        store.Reload();

        var watchers = new List<FileSystemWatcher>();
        foreach (var directory in Directories())
        {
            var watcher = TryCreateWatcher(directory);
            if (watcher is not null)
            {
                watchers.Add(watcher);
            }
        }

        var fingerprint = ComputeFingerprint();
        var lastPoll = DateTimeOffset.UtcNow;

        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                var now = DateTimeOffset.UtcNow;
                var shouldReload = false;

                lock (_gate)
                {
                    if (_pendingSince is DateTimeOffset since && now - since >= Debounce)
                    {
                        _pendingSince = null;
                        shouldReload = true;
                    }
                }

                if (!shouldReload && now - lastPoll >= PollInterval)
                {
                    lastPoll = now;
                    var current = ComputeFingerprint();
                    if (current != fingerprint)
                    {
                        logger.LogDebug("Changement de règles détecté par relevé d'empreinte.");
                        shouldReload = true;
                    }
                }

                if (!shouldReload)
                {
                    continue;
                }

                try
                {
                    store.Reload();
                }
                catch (Exception ex)
                {
                    // Un rechargement raté laisse le jeu de règles précédent en place.
                    logger.LogError(ex, "Rechargement des règles impossible ; le jeu précédent reste actif.");
                }

                fingerprint = ComputeFingerprint();
                lastPoll = DateTimeOffset.UtcNow;
            }
        }
        catch (OperationCanceledException)
        {
            // Arrêt normal.
        }
        finally
        {
            foreach (var watcher in watchers)
            {
                watcher.Dispose();
            }
        }
    }

    private IEnumerable<string> Directories()
    {
        yield return _options.RulesDirectory;

        if (!PathsEqual(_options.RulesDirectory, _options.UserRulesDirectory))
        {
            yield return _options.UserRulesDirectory;
        }
    }

    private static bool PathsEqual(string left, string right)
    {
        try
        {
            return string.Equals(
                Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar),
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
        }
        catch (Exception)
        {
            return false;
        }
    }

    private FileSystemWatcher? TryCreateWatcher(string directory)
    {
        if (!Directory.Exists(directory))
        {
            logger.LogInformation("Répertoire de règles {Directory} absent : non surveillé.", directory);
            return null;
        }

        try
        {
            var watcher = new FileSystemWatcher(directory)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            };

            watcher.Changed += OnFileEvent;
            watcher.Created += OnFileEvent;
            watcher.Deleted += OnFileEvent;
            watcher.Renamed += OnFileEvent;
            watcher.Error += (_, args) =>
                logger.LogWarning(args.GetException(), "Surveillance de {Directory} interrompue ; le relevé périodique prend le relais.", directory);

            watcher.EnableRaisingEvents = true;
            logger.LogInformation("Surveillance des règles active sur {Directory}.", directory);
            return watcher;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Surveillance de {Directory} impossible ; le relevé périodique prend le relais.", directory);
            return null;
        }
    }

    private void OnFileEvent(object sender, FileSystemEventArgs args)
    {
        if (!IsRuleFile(args.FullPath) && args.ChangeType != WatcherChangeTypes.Renamed)
        {
            return;
        }

        lock (_gate)
        {
            // Le débounce absorbe les écritures multiples d'un même enregistrement.
            _pendingSince = DateTimeOffset.UtcNow;
        }
    }

    private static bool IsRuleFile(string path) =>
        path.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase) ||
        path.EndsWith(".yml", StringComparison.OrdinalIgnoreCase);

    /// <summary>Empreinte des fichiers de règles : chemin, taille et date de modification.</summary>
    private string ComputeFingerprint()
    {
        var builder = new StringBuilder();

        foreach (var directory in Directories())
        {
            if (!Directory.Exists(directory))
            {
                continue;
            }

            IEnumerable<string> files;
            try
            {
                files = Directory
                    .EnumerateFiles(directory, "*.*", SearchOption.AllDirectories)
                    .Where(IsRuleFile)
                    .OrderBy(path => path, StringComparer.Ordinal);
            }
            catch (IOException ex)
            {
                logger.LogDebug(ex, "Énumération de {Directory} impossible pour le relevé d'empreinte.", directory);
                continue;
            }

            foreach (var file in files)
            {
                try
                {
                    var info = new FileInfo(file);
                    builder.Append(file).Append('|')
                        .Append(info.Length).Append('|')
                        .Append(info.LastWriteTimeUtc.Ticks).Append('\n');
                }
                catch (IOException)
                {
                    // Fichier en cours d'écriture : le prochain relevé le prendra en compte.
                }
            }
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }
}
