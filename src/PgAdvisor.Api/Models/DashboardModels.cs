namespace PgAdvisor.Api.Models;

public sealed record DashboardResponse
{
    /// <summary>Moyenne des scores des instances actives ; null si aucune instance n'a encore été analysée.</summary>
    public int? GlobalHealth { get; init; }

    public IReadOnlyList<ConnectionResponse> Instances { get; init; } = [];
    public required FindingSummaryResponse Summary { get; init; }
    public required RulesStatusResponse Rules { get; init; }
}

public sealed record RulesStatusResponse
{
    public int Total { get; init; }
    public int Enabled { get; init; }
    public int Provided { get; init; }
    public int User { get; init; }
    public DateTimeOffset LoadedAt { get; init; }
    public IReadOnlyList<RuleErrorResponse> Errors { get; init; } = [];
    public Dictionary<string, int> ByCategory { get; init; } = [];
}

public sealed record RuleErrorResponse(string File, string? RuleId, string Message, string Origin);
