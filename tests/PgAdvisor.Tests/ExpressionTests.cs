using PgAdvisor.Api.Rules.Expressions;

namespace PgAdvisor.Tests;

public class ExpressionTests
{
    private static object? Evaluate(string source, params (string Name, object? Value)[] variables)
    {
        var context = variables.ToDictionary(v => v.Name, v => v.Value, StringComparer.OrdinalIgnoreCase);
        return ExpressionParser.Parse(source).Evaluate(context);
    }

    [Theory]
    [InlineData("1 + 2 * 3", 7d)]
    [InlineData("(1 + 2) * 3", 9d)]
    [InlineData("10 % 3", 1d)]
    [InlineData("-4 + 1", -3d)]
    [InlineData("2e3 / 2", 1000d)]
    public void Arithmetique(string source, double expected)
    {
        Assert.Equal(expected, Assert.IsType<double>(Evaluate(source)));
    }

    [Fact]
    public void DivisionParZeroDonneNull()
    {
        // Comportement voulu : équivalent d'un NULLIF côté SQL, la condition devient fausse.
        Assert.Null(Evaluate("1 / 0"));
        Assert.False(ValueOps.ToBool(Evaluate("1 / 0 > 0")));
    }

    [Theory]
    [InlineData("ratio > 0.20", 0.25, true)]
    [InlineData("ratio > 0.20", 0.15, false)]
    [InlineData("ratio >= 0.25", 0.25, true)]
    [InlineData("ratio != 0.25", 0.25, false)]
    [InlineData("ratio == 0.25", 0.25, true)]
    [InlineData("ratio <> 0.25", 0.30, true)]
    public void Comparaisons(string source, double ratio, bool expected)
    {
        Assert.Equal(expected, ValueOps.ToBool(Evaluate(source, ("ratio", ratio))));
    }

    [Fact]
    public void MetriqueNulleRendLaConditionFausse()
    {
        // Une statistique absente ne doit jamais déclencher un finding ni lever d'exception.
        Assert.False(ValueOps.ToBool(Evaluate("ratio > 0.2", ("ratio", null))));
        Assert.False(ValueOps.ToBool(Evaluate("ratio < 0.2", ("ratio", null))));
        Assert.True(ValueOps.ToBool(Evaluate("ratio is null", ("ratio", null))));
        Assert.True(ValueOps.ToBool(Evaluate("ratio is not null", ("ratio", 1))));
    }

    [Fact]
    public void ColonneAbsenteEstTraiteeCommeNulle()
    {
        Assert.False(ValueOps.ToBool(Evaluate("colonne_inexistante > 0")));
    }

    [Theory]
    [InlineData("used::float / (max_connections - reserved) > 0.85", 90, 100, 3, true)]
    [InlineData("used::float / (max_connections - reserved) > 0.85", 50, 100, 3, false)]
    public void CastEtExpressionComposee(string source, int used, int max, int reserved, bool expected)
    {
        var result = Evaluate(source, ("used", used), ("max_connections", max), ("reserved", reserved));
        Assert.Equal(expected, ValueOps.ToBool(result));
    }

    [Fact]
    public void CastEntierTronque()
    {
        Assert.Equal(3L, Evaluate("valeur::int", ("valeur", 3.7)));
        Assert.Equal("3.7", Evaluate("valeur::text", ("valeur", 3.7)));
    }

    [Theory]
    [InlineData("a and b", true, true, true)]
    [InlineData("a and b", true, false, false)]
    [InlineData("a or b", false, true, true)]
    [InlineData("not a", true, false, false)]
    public void OperateursLogiques(string source, bool a, bool b, bool expected)
    {
        Assert.Equal(expected, ValueOps.ToBool(Evaluate(source, ("a", a), ("b", b))));
    }

    [Fact]
    public void ComparaisonAvecBooleen()
    {
        // Les colonnes booléennes de PostgreSQL sont comparées telles quelles.
        Assert.True(ValueOps.ToBool(Evaluate("is_compressed == false", ("is_compressed", false))));
        Assert.True(ValueOps.ToBool(Evaluate("is_compressed == false and age > 7",
            ("is_compressed", false), ("age", 10))));
    }

    [Fact]
    public void ComparaisonDeChaines()
    {
        Assert.True(ValueOps.ToBool(Evaluate("setting == 'off'", ("setting", "off"))));
        Assert.False(ValueOps.ToBool(Evaluate("setting == 'off'", ("setting", "on"))));
    }

    [Theory]
    [InlineData("coalesce(a, b)", 5d)]
    [InlineData("abs(-3)", 3d)]
    [InlineData("round(3.456, 2)", 3.46)]
    [InlineData("greatest(1, 9, 4)", 9d)]
    [InlineData("least(1, 9, 4)", 1d)]
    public void Fonctions(string source, double expected)
    {
        var result = Evaluate(source, ("a", null), ("b", 5d));
        Assert.Equal(expected, Convert.ToDouble(result));
    }

    [Fact]
    public void DecimalNpgsqlEstComparable()
    {
        // Npgsql rend les colonnes numeric sous forme de decimal.
        Assert.True(ValueOps.ToBool(Evaluate("ratio > 0.2", ("ratio", 0.35m))));
    }

    [Theory]
    [InlineData("ratio >")]
    [InlineData("ratio > > 2")]
    [InlineData("(ratio > 2")]
    [InlineData("fonction_inconnue(1)")]
    [InlineData("ratio ~ 2")]
    [InlineData("'chaine non terminee")]
    public void SyntaxeInvalideEstRefusee(string source)
    {
        Assert.False(ExpressionParser.TryParse(source, out _, out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void ReferencesListeLesColonnesUtilisees()
    {
        var expression = ExpressionParser.Parse("n_dead_tup::float / n_live_tup > seuil");
        Assert.Equal(["n_dead_tup", "n_live_tup", "seuil"], expression.References().Order().ToArray());
    }
}
