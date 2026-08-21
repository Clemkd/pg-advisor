using PgAdvisor.Api.Rules.Expressions;

namespace PgAdvisor.Tests;

/// <summary>
/// Some rules read counters cumulative since the last statistics reset. A total never comes back
/// down, so once the threshold was crossed the finding could not resolve, however long the problem
/// had been over. The engine now hands the condition what moved since the previous measurement.
/// These tests pin the arithmetic that makes that work, including the first run, where there is
/// nothing to compare against yet.
/// </summary>
public class RuleDeltaTests
{
    private static readonly Expr Condition = ExpressionParser.Parse(
        "checkpoints_timed_delta + checkpoints_req_delta > minimum_checkpoints " +
        "and checkpoints_req_delta / (checkpoints_timed_delta + checkpoints_req_delta) > maximum_share");

    private static Dictionary<string, object?> Sample(double timedDelta, double requestedDelta) => new()
    {
        ["minimum_checkpoints"] = 10d,
        ["maximum_share"] = 0.3d,
        ["checkpoints_timed_delta"] = timedDelta,
        ["checkpoints_req_delta"] = requestedDelta,
    };

    [Fact]
    public void AForcedMajorityOverTheWindowIsReported() =>
        Assert.True(ValueOps.ToBool(Condition.Evaluate(Sample(timedDelta: 4, requestedDelta: 12))));

    /// <summary>
    /// The point of the whole exercise: an instance that misbehaved for a while and then settled
    /// stops being reported, where the cumulative totals would have kept it flagged forever.
    /// </summary>
    [Fact]
    public void AWindowThatHasSettledIsNoLongerReported() =>
        Assert.False(ValueOps.ToBool(Condition.Evaluate(Sample(timedDelta: 20, requestedDelta: 1))));

    [Fact]
    public void TooFewCheckpointsInTheWindowIsNotAVerdict() =>
        Assert.False(ValueOps.ToBool(Condition.Evaluate(Sample(timedDelta: 2, requestedDelta: 2))));

    /// <summary>
    /// On the very first run no sample exists, so the delta variables are simply absent. They must
    /// evaluate to nothing and leave the rule silent — not raise, which the guard would count as
    /// an incident and eventually quarantine the rule for.
    /// </summary>
    [Fact]
    public void TheFirstRunIsSilentRatherThanFailing()
    {
        var withoutDeltas = new Dictionary<string, object?>
        {
            ["minimum_checkpoints"] = 10d,
            ["maximum_share"] = 0.3d,
        };

        var verdict = Record.Exception(() => ValueOps.ToBool(Condition.Evaluate(withoutDeltas)));

        Assert.Null(verdict);
        Assert.False(ValueOps.ToBool(Condition.Evaluate(withoutDeltas)));
    }

    /// <summary>A window with no activity at all must not divide by zero into a verdict.</summary>
    [Fact]
    public void AnIdleWindowIsSilent() =>
        Assert.False(ValueOps.ToBool(Condition.Evaluate(Sample(timedDelta: 0, requestedDelta: 0))));
}
