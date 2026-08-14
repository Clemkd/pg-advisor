using Microsoft.Extensions.Logging.Abstractions;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Rules.Handlers;

namespace PgAdvisor.Tests;

public class RuleLoaderTests
{
    private static readonly RuleLoader Loader = new(
        new RuleHandlerRegistry([new MissingExtensionHandler(), new RedundantIndexHandler()]),
        NullLogger<RuleLoader>.Instance);

    private const string ValidYaml = """
        id: vacuum.test
        version: 2
        name: Règle de test
        category: vacuum
        severity: warning
        group: recommendations
        requires:
          views:
            - pg_stat_user_tables
          minVersion: 14
        parameters:
          threshold: 0.2
        query: |
          SELECT schemaname, relname, ratio FROM pg_stat_user_tables
        condition: ratio > threshold
        key:
          - schemaname
          - relname
        recommendation:
          title: "Problème sur {{ relname }}"
          message: "{{ ratio | percent }} de lignes mortes"
          impact: medium
          confidence: high
          sql: "VACUUM {{ schemaname }}.{{ relname }};"
          documentation: https://www.postgresql.org/docs/current/
        """;

    [Fact]
    public void RegleValideEstCompilee()
    {
        var result = Loader.Compile(ValidYaml, "test.yaml", RuleOrigin.User);

        Assert.Empty(result.Errors);
        Assert.NotNull(result.Rule);
        Assert.Equal("vacuum.test", result.Rule.Id);
        Assert.Equal(2, result.Rule.Definition.Version);
        Assert.Equal("vacuum", result.Rule.Category);
        Assert.Equal(["schemaname", "relname"], result.Rule.KeyColumns);
        Assert.NotNull(result.Rule.Condition);
        Assert.NotNull(result.Rule.SqlTemplate);
        Assert.True(result.Rule.IsEditable);
    }

    [Fact]
    public void SeuilsSontRamenesAuTypeNaturel()
    {
        var rule = Loader.Compile(ValidYaml, "test.yaml", RuleOrigin.User).Rule;

        // YamlDotNet rend « 0.2 » sous forme de chaîne ; le chargeur doit en faire un nombre
        // pour qu'il puisse servir de paramètre SQL typé.
        Assert.Equal(0.2, Assert.IsType<double>(rule!.Definition.Parameters!["threshold"]));
    }

    [Fact]
    public void MessageAbsentRetombeSurLeTitre()
    {
        var yaml = ValidYaml.Replace("  message: \"{{ ratio | percent }} de lignes mortes\"\n", string.Empty);
        var rule = Loader.Compile(yaml, "test.yaml", RuleOrigin.User).Rule;

        Assert.NotNull(rule);
        Assert.Equal(rule.TitleTemplate.Render(Vars()), rule.MessageTemplate.Render(Vars()));

        static Dictionary<string, object?> Vars() =>
            new(StringComparer.OrdinalIgnoreCase) { ["relname"] = "orders" };
    }

    [Theory]
    [InlineData("id: MAJUSCULES", "lowercase")]
    [InlineData("category: inexistante", "category")]
    [InlineData("severity: fatale", "severity")]
    [InlineData("group: inconnu", "group")]
    [InlineData("version: 0", "version")]
    public void MetadonneesInvalidesSontSignalees(string replacement, string expectedFragment)
    {
        var key = replacement.Split(':')[0];
        var yaml = string.Join('\n', ValidYaml.Split('\n')
            .Select(line => line.StartsWith($"{key}:", StringComparison.Ordinal) ? replacement : line));

        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains(expectedFragment, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RequeteEnEcritureEstRefusee()
    {
        var yaml = ValidYaml.Replace(
            "  SELECT schemaname, relname, ratio FROM pg_stat_user_tables",
            "  DELETE FROM pg_stat_user_tables");

        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("SELECT", StringComparison.Ordinal));
    }

    [Fact]
    public void RequetesMultiplesSontRefusees()
    {
        var yaml = ValidYaml.Replace(
            "  SELECT schemaname, relname, ratio FROM pg_stat_user_tables",
            "  SELECT 1; DROP TABLE clients");

        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("a single query", StringComparison.Ordinal));
    }

    [Fact]
    public void PointVirguleDansUnLitteralEstAccepte()
    {
        var yaml = ValidYaml.Replace(
            "  SELECT schemaname, relname, ratio FROM pg_stat_user_tables",
            "  SELECT schemaname, relname, ratio, 'a; b' AS libelle FROM pg_stat_user_tables");

        Assert.NotNull(Loader.Compile(yaml, "test.yaml", RuleOrigin.User).Rule);
    }

    [Fact]
    public void ConditionInvalideEstSignalee()
    {
        var yaml = ValidYaml.Replace("condition: ratio > threshold", "condition: ratio >");
        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("Invalid condition", StringComparison.Ordinal));
    }

    [Fact]
    public void GabaritInvalideEstSignale()
    {
        var yaml = ValidYaml.Replace("{{ ratio | percent }}", "{{ ratio | inconnu }}");
        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("message", StringComparison.Ordinal));
    }

    [Fact]
    public void HandlerInconnuEstRefuse()
    {
        var yaml = """
            id: test.handler
            version: 1
            name: Test
            category: extensions
            severity: info
            handler: handler.qui.nexiste.pas
            recommendation:
              title: "Test"
            """;

        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("Unknown handler", StringComparison.Ordinal));
    }

    [Fact]
    public void QueryEtHandlerSimultanesSontRefuses()
    {
        var yaml = ValidYaml + "\nhandler: indexes.redundant\n";
        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("or \"handler\"", StringComparison.Ordinal));
    }

    [Fact]
    public void RegleSansSourceNiPrerequisEstRefusee()
    {
        var yaml = """
            id: test.vide
            version: 1
            name: Test
            category: extensions
            severity: info
            recommendation:
              title: "Test"
            """;

        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("requirement", StringComparison.Ordinal));
    }

    [Fact]
    public void YamlMalformeNeLevePas()
    {
        var result = Loader.Compile("id: [non ferme\n  ???", "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.NotEmpty(result.Errors);
    }

    [Fact]
    public void ChampInconnuEstSignale()
    {
        // Une faute de frappe dans un nom de champ doit être visible, pas silencieusement ignorée.
        var yaml = ValidYaml + "\nseverty: warning\n";
        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.NotEmpty(result.Errors);
    }

    [Fact]
    public void DocumentationDoitEtreUneUrlHttp()
    {
        var yaml = ValidYaml.Replace(
            "  documentation: https://www.postgresql.org/docs/current/",
            "  documentation: file:///etc/passwd");

        var result = Loader.Compile(yaml, "test.yaml", RuleOrigin.User);

        Assert.Null(result.Rule);
        Assert.Contains(result.Errors, error => error.Contains("http", StringComparison.Ordinal));
    }

    // --- Applicabilité ----------------------------------------------------

    private static PgCapabilities Capabilities(
        string[]? views = null,
        (string Name, string Version)[]? extensions = null,
        int versionNum = 160004,
        bool monitor = false,
        bool recovery = false) => new()
        {
            ServerVersion = $"{versionNum / 10000}.0",
            ServerVersionNum = versionNum,
            HasPgMonitor = monitor,
            InRecovery = recovery,
            Views = new HashSet<string>(views ?? [], StringComparer.OrdinalIgnoreCase),
            Extensions = (extensions ?? [])
                .ToDictionary(e => e.Name, e => e.Version, StringComparer.OrdinalIgnoreCase),
        };

    [Fact]
    public void RegleApplicableQuandLesPrerequisSontSatisfaits()
    {
        var rule = Loader.Compile(ValidYaml, "test.yaml", RuleOrigin.User).Rule!;
        var result = rule.EvaluateApplicability(Capabilities(views: ["pg_stat_user_tables"]));

        Assert.True(result.IsApplicable);
        Assert.Null(result.Reason);
    }

    [Fact]
    public void VueManquanteDesactiveLaRegle()
    {
        var rule = Loader.Compile(ValidYaml, "test.yaml", RuleOrigin.User).Rule!;
        var result = rule.EvaluateApplicability(Capabilities());

        Assert.False(result.IsApplicable);
        Assert.Contains("pg_stat_user_tables", result.Reason);
    }

    [Fact]
    public void VersionTropAncienneDesactiveLaRegle()
    {
        var rule = Loader.Compile(ValidYaml, "test.yaml", RuleOrigin.User).Rule!;
        var result = rule.EvaluateApplicability(
            Capabilities(views: ["pg_stat_user_tables"], versionNum: 130010));

        Assert.False(result.IsApplicable);
        Assert.Contains("14", result.Reason);
    }

    [Fact]
    public void ExtensionAbsenteDesactiveLaRegleQuiEnDepend()
    {
        var yaml = """
            id: queries.test
            version: 1
            name: Test
            category: queries
            severity: warning
            requires:
              extensions:
                - pg_stat_statements
            query: |
              SELECT queryid, mean_exec_time FROM pg_stat_statements
            condition: mean_exec_time > 500
            recommendation:
              title: "Requête lente"
            """;

        var rule = Loader.Compile(yaml, "test.yaml", RuleOrigin.User).Rule!;

        Assert.False(rule.EvaluateApplicability(Capabilities()).IsApplicable);
        Assert.True(rule
            .EvaluateApplicability(Capabilities(extensions: [("pg_stat_statements", "1.10")]))
            .IsApplicable);
    }

    [Fact]
    public void RegleInverseeSeDeclencheQuandLExtensionEstAbsente()
    {
        var yaml = """
            id: extensions.test
            version: 1
            name: Test
            category: extensions
            severity: info
            requires:
              missingExtensions:
                - hypopg
            handler: capabilities.missing-extension
            recommendation:
              title: "Installer hypopg"
            """;

        var rule = Loader.Compile(yaml, "test.yaml", RuleOrigin.User).Rule!;

        Assert.True(rule.EvaluateApplicability(Capabilities()).IsApplicable);
        Assert.False(rule.EvaluateApplicability(Capabilities(extensions: [("hypopg", "1.4")])).IsApplicable);
    }

    [Fact]
    public void RegleReserveeAuPrimaireIgnoreUnReplica()
    {
        var yaml = ValidYaml.Replace("  minVersion: 14", "  primary: true");
        var rule = Loader.Compile(yaml, "test.yaml", RuleOrigin.User).Rule!;

        Assert.False(rule
            .EvaluateApplicability(Capabilities(views: ["pg_stat_user_tables"], recovery: true))
            .IsApplicable);
    }

    [Fact]
    public void CapabilitesInconnuesRendentLaRegleNonApplicable()
    {
        var rule = Loader.Compile(ValidYaml, "test.yaml", RuleOrigin.User).Rule!;
        Assert.False(rule.EvaluateApplicability(null).IsApplicable);
    }
}
