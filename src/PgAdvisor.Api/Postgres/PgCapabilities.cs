using System.Text.Json.Serialization;

namespace PgAdvisor.Api.Postgres;

/// <summary>
/// Capacités détectées sur une instance : version, extensions installées, vues système
/// réellement lisibles par l'utilisateur de supervision. Les règles s'appuient dessus pour
/// décider si elles peuvent s'exécuter — rien n'est installé ni modifié pour les obtenir.
/// </summary>
public sealed record PgCapabilities
{
    public string ServerVersion { get; init; } = string.Empty;
    public int ServerVersionNum { get; init; }
    public bool InRecovery { get; init; }
    public string CurrentUser { get; init; } = string.Empty;
    public bool IsSuperuser { get; init; }

    /// <summary>Appartenance à pg_monitor : donne accès aux statistiques des autres sessions.</summary>
    public bool HasPgMonitor { get; init; }

    /// <summary>Extensions installées : nom → version.</summary>
    public Dictionary<string, string> Extensions { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Extensions disponibles sur le serveur mais non installées.</summary>
    public List<string> AvailableExtensions { get; init; } = [];

    /// <summary>Vues et relations système effectivement lisibles (nom court et qualifié).</summary>
    public HashSet<string> Views { get; init; } = new(StringComparer.OrdinalIgnoreCase);

    public DateTimeOffset DetectedAt { get; init; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public string? TimescaleVersion =>
        Extensions.TryGetValue("timescaledb", out var version) ? version : null;

    public bool HasExtension(string name) => Extensions.ContainsKey(name);

    public bool HasView(string name) => Views.Contains(name);

    public bool MeetsVersion(int majorVersion) => ServerVersionNum >= majorVersion * 10_000;

    /// <summary>Liste à plat pour l'affichage « ✓ / ✗ » du dashboard.</summary>
    public IEnumerable<CapabilityStatus> Describe(IEnumerable<string> notableExtensions)
    {
        foreach (var view in Views.OrderBy(v => v, StringComparer.OrdinalIgnoreCase))
        {
            yield return new CapabilityStatus(view, "view", true, null);
        }

        foreach (var name in notableExtensions)
        {
            var present = Extensions.TryGetValue(name, out var version);
            yield return new CapabilityStatus(name, "extension", present, present ? version : null);
        }
    }
}

public sealed record CapabilityStatus(string Name, string Kind, bool Available, string? Version);
