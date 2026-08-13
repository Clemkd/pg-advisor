using PgAdvisor.Api.Rules.Expressions;

namespace PgAdvisor.Tests;

public class TemplateTests
{
    private static string Render(string source, params (string Name, object? Value)[] variables)
    {
        var context = variables.ToDictionary(v => v.Name, v => v.Value, StringComparer.OrdinalIgnoreCase);
        return Template.Parse(source).Render(context);
    }

    [Fact]
    public void InterpolationSimple()
    {
        Assert.Equal(
            "public.orders présente un problème",
            Render("{{ schemaname }}.{{ relname }} présente un problème",
                ("schemaname", "public"), ("relname", "orders")));
    }

    [Theory]
    [InlineData("{{ v | percent }}", 0.2034, "20.3 %")]
    [InlineData("{{ v | percent:0 }}", 0.2034, "20 %")]
    [InlineData("{{ v | round }}", 3.6, "4")]
    [InlineData("{{ v | round:2 }}", 3.14159, "3.14")]
    [InlineData("{{ v | integer }}", 3.6, "4")]
    public void FiltresNumeriques(string source, double value, string expected)
    {
        Assert.Equal(expected, Render(source, ("v", value)));
    }

    [Theory]
    [InlineData(512L, "512 B")]
    [InlineData(1536L, "1.5 KiB")]
    [InlineData(1073741824L, "1 GiB")]
    public void FiltreOctets(long value, string expected)
    {
        Assert.Equal(expected, Render("{{ v | bytes }}", ("v", value)));
    }

    [Theory]
    [InlineData(0.5, "0.5 ms")]
    [InlineData(512d, "512 ms")]
    [InlineData(1500d, "1.5 s")]
    [InlineData(90_000d, "1.5 min")]
    [InlineData(7_200_000d, "2 h")]
    public void FiltreDuree(double milliseconds, string expected)
    {
        Assert.Equal(expected, Render("{{ v | duration }}", ("v", milliseconds)));
    }

    [Fact]
    public void FiltreSecondes()
    {
        Assert.Equal("2 min", Render("{{ v | seconds }}", ("v", 120)));
    }

    [Fact]
    public void FiltreNombreGroupeLesMilliers()
    {
        Assert.Equal("1,234,567", Render("{{ v | number }}", ("v", 1234567L)));
    }

    [Fact]
    public void FiltresChainables()
    {
        Assert.Equal("3", Render("{{ v | round | number }}", ("v", 3.4)));
    }

    [Fact]
    public void ValeurNulleAfficheNa()
    {
        // Un message ne doit jamais afficher « vide » là où une métrique manque.
        Assert.Equal("n/a lignes", Render("{{ v | number }} lignes", ("v", null)));
    }

    [Fact]
    public void ExpressionDansInterpolation()
    {
        Assert.Equal(
            "50 %",
            Render("{{ morts / total | percent:0 }}", ("morts", 5d), ("total", 10d)));
    }

    [Theory]
    [InlineData("{{ v | filtre_inconnu }}")]
    [InlineData("{{ }}")]
    [InlineData("{{ v")]
    [InlineData("{{ v > }}")]
    public void GabaritInvalideEstRefuse(string source)
    {
        Assert.False(Template.TryParse(source, out _, out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void TexteSansInterpolationResteIntact()
    {
        Assert.Equal("Autovacuum désactivé", Render("Autovacuum désactivé"));
    }
}
