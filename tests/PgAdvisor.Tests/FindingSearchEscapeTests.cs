using PgAdvisor.Api.Controllers;

namespace PgAdvisor.Tests;

/// <summary>
/// The search box feeds a LIKE pattern. Left alone, a wildcard typed by the operator stops being
/// a character and becomes an instruction: a lone "%" matches every row of the table.
/// </summary>
public class FindingSearchEscapeTests
{
    [Theory]
    [InlineData("orders", "orders")]
    [InlineData("100%", @"100\%")]
    [InlineData("_id", @"\_id")]
    [InlineData("%", @"\%")]
    [InlineData("a%b_c", @"a\%b\_c")]
    public void WildcardsBecomeLiterals(string search, string expected) =>
        Assert.Equal(expected, FindingsController.EscapeLikePattern(search));

    /// <summary>
    /// The escape character has to be doubled before the wildcards are escaped, otherwise a
    /// backslash typed by the operator would swallow the escape the code just added.
    /// </summary>
    [Theory]
    [InlineData(@"\", @"\\")]
    [InlineData(@"\%", @"\\\%")]
    [InlineData(@"C:\temp_1", @"C:\\temp\_1")]
    public void TheEscapeCharacterIsEscapedFirst(string search, string expected) =>
        Assert.Equal(expected, FindingsController.EscapeLikePattern(search));
}
