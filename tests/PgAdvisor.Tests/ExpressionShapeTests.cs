using PgAdvisor.Api.Rules.Expressions;

namespace PgAdvisor.Tests;

/// <summary>
/// Parsing is a recursive descent, and POST /api/rules/validate hands it a string from the client.
/// A StackOverflowException cannot be caught in .NET: the shape has to be refused before the
/// recursion starts, not rescued afterwards.
/// </summary>
public class ExpressionShapeTests
{
    [Fact]
    public void DeeplyNestedParenthesesAreRefused()
    {
        // Under the token cap on purpose, so it is the nesting bound that answers, not the length one.
        var source = new string('(', 100) + "1" + new string(')', 100);

        Assert.False(ExpressionParser.TryParse(source, out var expression, out var error));
        Assert.Null(expression);
        Assert.Contains("nested too deeply", error, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Prefix operators recurse without a single parenthesis.</summary>
    [Fact]
    public void ALongRunOfPrefixOperatorsIsRefused()
    {
        var source = string.Concat(Enumerable.Repeat("not ", 5_000)) + "true";

        Assert.False(ExpressionParser.TryParse(source, out _, out var error));
        Assert.Contains("too long", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ALongFlatExpressionIsRefused()
    {
        var source = string.Join(" + ", Enumerable.Range(0, 1_000));

        Assert.False(ExpressionParser.TryParse(source, out _, out var error));
        Assert.Contains("too long", error, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The bounds have to leave real conditions alone.</summary>
    [Theory]
    [InlineData("ratio > threshold")]
    [InlineData("not (dead_ratio > 0.2 and n_live_tup > 1000)")]
    [InlineData("coalesce(idx_scan, 0) = 0 and seq_scan > 100")]
    [InlineData("((((a + b) * c) - d) / e) > 1")]
    [InlineData("size::float / greatest(total, 1) > 0.9")]
    public void OrdinaryConditionsStillParse(string source)
    {
        Assert.True(ExpressionParser.TryParse(source, out var expression, out var error), error);
        Assert.NotNull(expression);
    }
}
