using Microsoft.Extensions.Logging.Abstractions;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Rules.Handlers;

namespace PgAdvisor.Tests;

public class OverrideTests
{
    private const string Yaml = """
        id: vacuum.test
        version: 1
        name: Test
        category: vacuum
        severity: warning
        parameters:
          seuil: 0.2
          minimum: 1000
        query: |
          SELECT relname, ratio FROM pg_stat_user_tables
        condition: ratio > seuil
        recommendation:
          title: "Test"
        """;

    private static LoadedRule Rule() => new RuleLoader(
            new RuleHandlerRegistry([]),
            NullLogger<RuleLoader>.Instance)
        .Compile(Yaml, "test.yaml", RuleOrigin.User)
        .Rule!;

    [Fact]
    public void SansSurchargeLesValeursDuFichierSappliquent()
    {
        var effective = Rule().ApplyOverrides(null, null);

        Assert.True(effective.Enabled);
        Assert.Equal("warning", effective.Severity);
        Assert.Equal(0.2, effective.Parameters["seuil"]);
        Assert.Null(effective.IntervalSeconds);
    }

    [Fact]
    public void SurchargeGlobaleSapplique()
    {
        var global = new RuleOverride
        {
            RuleId = "vacuum.test",
            Severity = "critical",
            IntervalSeconds = 60,
            ParametersJson = """{"seuil": 0.5}""",
        };

        var effective = Rule().ApplyOverrides(global, null);

        Assert.Equal("critical", effective.Severity);
        Assert.Equal(60, effective.IntervalSeconds);
        Assert.Equal(0.5, effective.Parameters["seuil"]);
        // Un seuil non surchargé conserve la valeur du fichier.
        Assert.Equal(1000L, effective.Parameters["minimum"]);
    }

    [Fact]
    public void SurchargeInstanceLemporteSurLaSurchargeGlobale()
    {
        var global = new RuleOverride { Severity = "critical", ParametersJson = """{"seuil": 0.5}""" };
        var instance = new RuleOverride { Severity = "info", ParametersJson = """{"seuil": 0.9}""" };

        var effective = Rule().ApplyOverrides(global, instance);

        Assert.Equal("info", effective.Severity);
        Assert.Equal(0.9, effective.Parameters["seuil"]);
    }

    [Fact]
    public void DesactivationParSurcharge()
    {
        var effective = Rule().ApplyOverrides(new RuleOverride { Enabled = false }, null);
        Assert.False(effective.Enabled);
    }

    [Fact]
    public void SurchargeIllisibleRetombeSurLeFichier()
    {
        var effective = Rule().ApplyOverrides(
            new RuleOverride { ParametersJson = "{ceci n'est pas du json" }, null);

        Assert.Equal(0.2, effective.Parameters["seuil"]);
    }
}

public class HealthScoreTests
{
    private readonly HealthScoreCalculator _calculator = new();

    [Fact]
    public void AucunFindingDonneCentPartout()
    {
        var score = _calculator.Compute([], ["vacuum", "indexes"]);

        Assert.Equal(100, score.Global);
        Assert.Equal(100, score.Categories["vacuum"]);
        Assert.Equal(100, score.Categories["indexes"]);
        Assert.Equal(0, score.Total);
    }

    [Fact]
    public void AucuneCategorieEvalueeDonneCent()
    {
        // Instance dont aucune règle n'est applicable : on n'invente pas un score dégradé.
        Assert.Equal(100, _calculator.Compute([], []).Global);
    }

    [Fact]
    public void PenalitesParSeverite()
    {
        var score = _calculator.Compute(
            [
                new FindingWeight("vacuum", Severities.Critical),
                new FindingWeight("indexes", Severities.Warning),
                new FindingWeight("storage", Severities.Info),
            ],
            ["vacuum", "indexes", "storage"]);

        Assert.Equal(75, score.Categories["vacuum"]);
        Assert.Equal(92, score.Categories["indexes"]);
        Assert.Equal(98, score.Categories["storage"]);
        Assert.Equal(88, score.Global);
        Assert.Equal(1, score.Critical);
        Assert.Equal(1, score.Warning);
        Assert.Equal(1, score.Info);
    }

    [Fact]
    public void PenalitesCumuleesEtBornees()
    {
        var findings = Enumerable.Range(0, 10)
            .Select(_ => new FindingWeight("vacuum", Severities.Critical))
            .ToList();

        var score = _calculator.Compute(findings, ["vacuum"]);

        Assert.Equal(0, score.Categories["vacuum"]);
        Assert.Equal(0, score.Global);
    }

    [Fact]
    public void CategorieNonEvalueeMaisPorteuseDeFindingsEstNotee()
    {
        // Une capability perdue ne doit pas faire disparaître un diagnostic du score.
        var score = _calculator.Compute([new FindingWeight("timescaledb", Severities.Warning)], ["vacuum"]);

        Assert.True(score.Categories.ContainsKey("timescaledb"));
        Assert.Equal(92, score.Categories["timescaledb"]);
        Assert.Equal(96, score.Global);
    }
}

public class SqlGuardTests
{
    [Theory]
    [InlineData("SELECT 1")]
    [InlineData("select 1")]
    [InlineData("  SELECT 1;  ")]
    [InlineData("WITH x AS (SELECT 1) SELECT * FROM x")]
    [InlineData("EXPLAIN SELECT 1")]
    [InlineData("SELECT 'a; b'")]
    [InlineData("SELECT 1 -- commentaire ; avec point-virgule")]
    [InlineData("SELECT 1 /* bloc ; imbriqué /* interne */ */")]
    [InlineData("SELECT $tag$texte ; libre$tag$")]
    public void RequetesAcceptees(string sql)
    {
        Assert.True(SqlGuard.Validate(sql, out var error), error);
    }

    [Theory]
    [InlineData("DELETE FROM t")]
    [InlineData("UPDATE t SET a = 1")]
    [InlineData("DROP TABLE t")]
    [InlineData("SELECT 1; SELECT 2")]
    [InlineData("VACUUM FULL")]
    [InlineData("")]
    [InlineData("   ")]
    public void RequetesRefusees(string sql)
    {
        Assert.False(SqlGuard.Validate(sql, out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }
}
