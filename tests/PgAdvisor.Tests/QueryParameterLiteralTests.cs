using PgAdvisor.Api.Postgres;

namespace PgAdvisor.Tests;

/// <summary>
/// Parameter values are substituted into the statement that RunExplainAsync wraps in EXPLAIN.
/// A value is data: it must never be able to close its own quote and reopen the statement.
/// </summary>
public class QueryParameterLiteralTests
{
    [Theory]
    [InlineData("42", "42")]
    [InlineData("-1.5", "-1.5")]
    [InlineData("true", "true")]
    [InlineData("false", "false")]
    [InlineData("null", "NULL")]
    [InlineData("NULL", "NULL")]
    [InlineData("", "NULL")]
    public void NumbersBooleansAndNullKeepTheirSqlForm(string value, string expected) =>
        Assert.Equal(expected, QueryAnalysisService.FormatLiteral(value));

    [Theory]
    [InlineData("paris", "'paris'")]
    [InlineData("O'Brien", "'O''Brien'")]
    public void TextIsQuotedAndEscaped(string value, string expected) =>
        Assert.Equal(expected, QueryAnalysisService.FormatLiteral(value));

    /// <summary>
    /// A value that already looks like a quoted literal used to be returned verbatim, which let
    /// the caller append arbitrary SQL to the analysed statement.
    /// </summary>
    [Theory]
    [InlineData("'||(SELECT current_setting('is_superuser'))||'")]
    [InlineData("'; DROP TABLE users; --")]
    [InlineData("' OR '1'='1")]
    [InlineData("'already quoted'")]
    public void AValueThatLooksLikeALiteralIsStillEscaped(string value)
    {
        var literal = QueryAnalysisService.FormatLiteral(value);

        // One opening quote, one closing quote, and every inner quote doubled: the value cannot
        // terminate the literal it sits in.
        Assert.StartsWith("'", literal, StringComparison.Ordinal);
        Assert.EndsWith("'", literal, StringComparison.Ordinal);
        Assert.Equal(0, CountUnescapedQuotes(literal[1..^1]));
    }

    private static int CountUnescapedQuotes(string body)
    {
        var unescaped = 0;

        for (var index = 0; index < body.Length; index++)
        {
            if (body[index] != '\'')
            {
                continue;
            }

            if (index + 1 < body.Length && body[index + 1] == '\'')
            {
                index++;
                continue;
            }

            unescaped++;
        }

        return unescaped;
    }
}
