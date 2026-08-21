using PgAdvisor.Api.Services;

namespace PgAdvisor.Tests;

/// <summary>
/// The two shapes used to be three copies under one name, disagreeing on whether the ellipsis
/// counted towards the limit. They are separate names now, and these pin the difference down.
/// </summary>
public class TextTests
{
    [Theory]
    [InlineData("short", 10, "short")]
    [InlineData("exactly-ten", 11, "exactly-ten")]
    [InlineData("far too long to fit", 10, "far too l…")]
    public void EllipsisNeverExceedsTheLimit(string value, int max, string expected)
    {
        var result = Text.Ellipsis(value, max);

        Assert.Equal(expected, result);
        Assert.True(result.Length <= max, $"\"{result}\" is {result.Length} characters for a limit of {max}.");
    }

    [Fact]
    public void EllipsisRefusesALimitThatCannotHoldIt() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => Text.Ellipsis("anything", 0));

    [Theory]
    [InlineData(null, null)]
    [InlineData("short", "short")]
    [InlineData("far too long to fit", "far too lo")]
    public void ClipCutsWithoutAddingAnything(string? value, string? expected) =>
        Assert.Equal(expected, Text.Clip(value, 10));
}
