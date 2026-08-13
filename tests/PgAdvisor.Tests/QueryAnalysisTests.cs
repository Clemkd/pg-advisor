using PgAdvisor.Api.Postgres;

namespace PgAdvisor.Tests;

public class ExplainPrefixTests
{
    [Theory]
    [InlineData("EXPLAIN SELECT 1", "SELECT 1")]
    [InlineData("explain select 1", "select 1")]
    [InlineData("EXPLAIN (ANALYZE, BUFFERS) SELECT 1", "SELECT 1")]
    [InlineData("EXPLAIN (FORMAT JSON, VERBOSE, COSTS) SELECT c.id FROM commandes c", "SELECT c.id FROM commandes c")]
    [InlineData("EXPLAIN ANALYZE VERBOSE SELECT 1", "SELECT 1")]
    [InlineData("  EXPLAIN   SELECT 1  ", "SELECT 1")]
    public void PrefixeExplainRetire(string input, string expected)
    {
        Assert.Equal(expected, QueryAnalysisService.StripExplainPrefix(input));
    }

    [Theory]
    [InlineData("SELECT 1")]
    [InlineData("WITH x AS (SELECT 1) SELECT * FROM x")]
    [InlineData("SELECT 'EXPLAIN' AS mot")]
    public void RequeteSansPrefixeInchangee(string input)
    {
        Assert.Equal(input, QueryAnalysisService.StripExplainPrefix(input));
    }

    [Theory]
    [InlineData("SELECT 1", 0)]
    [InlineData("SELECT * FROM t WHERE a = $1", 1)]
    [InlineData("SELECT * FROM t WHERE a = $1 AND b = $2", 2)]
    [InlineData("SELECT * FROM t WHERE a = $2 AND b = $1", 2)]
    // Le compte suit le plus grand indice : $1 puis $3 réclame bien trois valeurs.
    [InlineData("SELECT * FROM t WHERE a = $1 AND b = $3", 3)]
    public void ComptageDesParametres(string sql, int expected)
    {
        Assert.Equal(expected, QueryAnalysisService.PlaceholderCount(sql));
    }
}

public class MergedRankingTests
{
    private static TopQuery Query(string id, double total = 0, double mean = 0, long calls = 0,
        long rows = 0, long read = 0, long written = 0, long temp = 0) => new()
    {
        QueryId = id,
        TotalExecMs = total,
        MeanExecMs = mean,
        Calls = calls,
        Rows = rows,
        SharedBlksRead = read,
        SharedBlksWritten = written,
        TempBlksWritten = temp,
    };

    [Theory]
    [InlineData("total_time", 120)]
    [InlineData("mean_time", 12)]
    [InlineData("calls", 10)]
    [InlineData("rows", 500)]
    // Les entrées/sorties additionnent lectures et écritures, comme le tri côté serveur.
    [InlineData("io", 70)]
    [InlineData("temp", 8)]
    public void ChaqueCritereRejoueLaMemeDefinition(string sortKey, double expected)
    {
        var query = Query("1", total: 120, mean: 12, calls: 10, rows: 500, read: 50, written: 20, temp: 8);

        Assert.Equal(expected, QueryAnalysisService.SortScore(query, sortKey));
    }

    [Fact]
    public void FusionDeDeuxInstancesClasseeSurLeMemeCritere()
    {
        var premiere = new[] { Query("a", total: 900), Query("b", total: 100) };
        var seconde = new[] { Query("c", total: 500), Query("d", total: 300) };

        var merged = premiere.Concat(seconde)
            .OrderByDescending(q => QueryAnalysisService.SortScore(q, "total_time"))
            .Take(3)
            .Select(q => q.QueryId);

        Assert.Equal(["a", "c", "d"], merged);
    }
}

public class QueryParameterSuggesterTests
{
    private const string Normalized = """
        SELECT c.id, cl.nom
        FROM public.commandes AS c
        JOIN clients cl ON cl.id = c.client_id
        WHERE c.statut = $1 AND c.total >= $2 AND cl.pays IN ($3) AND c.reference ILIKE $4
        ORDER BY c.créé_le DESC
        """;

    [Fact]
    public void ChaqueParametreEstRelieASaColonne()
    {
        var comparisons = QueryParameterSuggester.ReadComparisons(Normalized);

        Assert.Equal(("c", "statut"), comparisons[1]);
        Assert.Equal(("c", "total"), comparisons[2]);
        // Forme « IN ($3) » : la parenthèse ne doit pas rompre la reconnaissance.
        Assert.Equal(("cl", "pays"), comparisons[3]);
        Assert.Equal(("c", "reference"), comparisons[4]);
    }

    [Fact]
    public void RelationsEtAliasReconnus()
    {
        var relations = QueryParameterSuggester.ReadRelations(Normalized);

        Assert.Contains(relations, r => r is { Schema: "public", Table: "commandes", Alias: "c" });
        Assert.Contains(relations, r => r is { Schema: null, Table: "clients", Alias: "cl" });
    }

    [Theory]
    // Sans alias, et sans rien après le nom de la relation.
    [InlineData("SELECT * FROM commandes", "commandes", null)]
    // Un mot-clé qui suit la relation n'est pas un alias.
    [InlineData("SELECT * FROM commandes WHERE statut = $1", "commandes", null)]
    [InlineData("DELETE FROM public.commandes c WHERE c.id = $1", "commandes", "c")]
    public void MotCleJamaisConfonduAvecUnAlias(string sql, string table, string? alias)
    {
        var relation = Assert.Single(QueryParameterSuggester.ReadRelations(sql));

        Assert.Equal(table, relation.Table);
        Assert.Equal(alias, relation.Alias);
    }

    [Fact]
    public void ColonneSansQualificatifAcceptee()
    {
        var comparisons = QueryParameterSuggester.ReadComparisons("SELECT * FROM commandes WHERE statut = $1");

        Assert.Equal((null, "statut"), comparisons[1]);
    }
}

public class ExplainPlanParserTests
{
    private const string AnalyzedPlan = """
        [
          {
            "Plan": {
              "Node Type": "Aggregate",
              "Total Cost": 2943.19,
              "Startup Cost": 2943.16,
              "Plan Rows": 3,
              "Plan Width": 15,
              "Actual Total Time": 95.5,
              "Actual Rows": 3,
              "Actual Loops": 1,
              "Plans": [
                {
                  "Node Type": "Hash Join",
                  "Total Cost": 2743.16,
                  "Startup Cost": 1943.15,
                  "Plan Rows": 40000,
                  "Plan Width": 7,
                  "Actual Total Time": 89.7,
                  "Actual Rows": 40000,
                  "Actual Loops": 1,
                  "Hash Cond": "(l.commande_id = c.id)",
                  "Plans": [
                    {
                      "Node Type": "Seq Scan",
                      "Schema": "public",
                      "Relation Name": "lignes_commande",
                      "Alias": "l",
                      "Total Cost": 695.0,
                      "Startup Cost": 0.0,
                      "Plan Rows": 40000,
                      "Plan Width": 8,
                      "Actual Total Time": 12.0,
                      "Actual Rows": 400000,
                      "Actual Loops": 1,
                      "Shared Read Blocks": 250
                    },
                    {
                      "Node Type": "Sort",
                      "Total Cost": 1300.0,
                      "Startup Cost": 1300.0,
                      "Plan Rows": 51429,
                      "Plan Width": 11,
                      "Actual Total Time": 40.0,
                      "Actual Rows": 51429,
                      "Actual Loops": 1,
                      "Sort Method": "external merge",
                      "Sort Space Type": "Disk",
                      "Sort Space Used": 4096,
                      "Temp Written Blocks": 512
                    }
                  ]
                }
              ]
            },
            "Planning Time": 0.29,
            "Execution Time": 96.1,
            "Settings": { "work_mem": "4MB" }
          }
        ]
        """;

    [Fact]
    public void ArbreAplatiAvecProfondeurs()
    {
        var plan = ExplainPlanParser.Parse(AnalyzedPlan);

        Assert.Equal(4, plan.Nodes.Count);
        Assert.Equal([0, 1, 2, 2], plan.Nodes.Select(n => n.Depth).ToArray());
        Assert.Equal("Aggregate", plan.Nodes[0].NodeType);
        Assert.Null(plan.Nodes[0].ParentId);
        Assert.Equal(0, plan.Nodes[1].ParentId);
        Assert.True(plan.Analyzed);
        Assert.Equal(96.1, plan.ExecutionMs);
        Assert.Equal(0.29, plan.PlanningMs);
        Assert.Equal("4MB", plan.Settings["work_mem"]);
    }

    [Fact]
    public void TempsPropreExcluantLesEnfants()
    {
        var plan = ExplainPlanParser.Parse(AnalyzedPlan);

        // Aggregate : 95,5 cumulé - 89,7 de son enfant = 5,8 de temps propre.
        Assert.Equal(5.8, plan.Nodes[0].SelfMs!.Value, 1);
        // Hash Join : 89,7 - (12 + 40) = 37,7.
        Assert.Equal(37.7, plan.Nodes[1].SelfMs!.Value, 1);
        // Une feuille garde tout son temps.
        Assert.Equal(12, plan.Nodes[2].SelfMs!.Value, 1);
    }

    [Fact]
    public void PartDuTempsRapporteeALExecution()
    {
        var plan = ExplainPlanParser.Parse(AnalyzedPlan);
        var total = plan.Nodes.Sum(n => n.SelfSharePercent ?? 0);

        Assert.InRange(total, 99, 101);
    }

    [Fact]
    public void EcartDEstimationDetecte()
    {
        var plan = ExplainPlanParser.Parse(AnalyzedPlan);
        var seqScan = plan.Nodes.Single(n => n.NodeType == "Seq Scan");

        // 400 000 lignes réelles pour 40 000 estimées : facteur 10 de sous-estimation.
        Assert.Equal(10, seqScan.EstimationFactor!.Value, 1);
        Assert.Contains(seqScan.Warnings, w => w.Kind == "bad-estimate");
    }

    [Fact]
    public void ParcoursSequentielVolumineuxSignale()
    {
        var plan = ExplainPlanParser.Parse(AnalyzedPlan);
        var seqScan = plan.Nodes.Single(n => n.NodeType == "Seq Scan");

        Assert.Contains(seqScan.Warnings, w => w.Kind == "seq-scan");

        // Le schéma public est du bruit : il n'est pas répété dans le libellé.
        Assert.Equal("lignes_commande", seqScan.RelationName);
        Assert.Equal("Seq Scan — lignes_commande (l)", seqScan.Label);
    }

    [Fact]
    public void SchemaNonPublicConserveDansLeLibelle()
    {
        const string plan = """
            [{"Plan":{"Node Type":"Seq Scan","Schema":"facturation","Relation Name":"factures","Alias":"f",
              "Total Cost":10.0,"Startup Cost":0.0,"Plan Rows":1,"Plan Width":4}}]
            """;

        var node = ExplainPlanParser.Parse(plan).Nodes.Single();

        Assert.Equal("facturation.factures", node.RelationName);
        Assert.Equal("Seq Scan — facturation.factures (f)", node.Label);
    }

    [Fact]
    public void TriSurDisqueSignale()
    {
        var plan = ExplainPlanParser.Parse(AnalyzedPlan);
        var sort = plan.Nodes.Single(n => n.NodeType == "Sort");

        Assert.Contains(sort.Warnings, w => w.Kind == "sort-on-disk");
        Assert.Contains(sort.Warnings, w => w.Kind == "temp-blocks");
        Assert.Equal(4096, sort.SortSpaceUsedKb);
    }

    [Fact]
    public void PlanSansExecutionResteExploitable()
    {
        const string planOnly = """
            [{"Plan":{"Node Type":"Seq Scan","Relation Name":"commandes","Total Cost":1300.0,"Startup Cost":0.0,"Plan Rows":51429,"Plan Width":11}}]
            """;

        var plan = ExplainPlanParser.Parse(planOnly);

        Assert.False(plan.Analyzed);
        Assert.Null(plan.ExecutionMs);
        Assert.Single(plan.Nodes);
        Assert.Null(plan.Nodes[0].SelfMs);
        Assert.Equal(100, plan.Nodes[0].CostSharePercent, 1);
    }

    [Fact]
    public void SousPlanParallelismeEtBrancheJamaisExecutee()
    {
        const string plan = """
            [{"Plan":{"Node Type":"Append","Total Cost":100.0,"Plan Rows":10,"Actual Total Time":5.0,"Actual Rows":10,"Actual Loops":1,
              "Plans":[
                {"Node Type":"Seq Scan","Subplan Name":"CTE recents","Parallel Aware":true,"Workers Planned":2,"Workers Launched":2,
                 "Total Cost":60.0,"Plan Rows":10,"Actual Total Time":4.0,"Actual Rows":10,"Actual Loops":1},
                {"Node Type":"Index Scan","Index Name":"idx","Never Executed":true,"Total Cost":40.0,"Plan Rows":5000}]}}]
            """;

        var parsed = ExplainPlanParser.Parse(plan);
        var cte = parsed.Nodes.Single(n => n.NodeType == "Seq Scan");
        var skipped = parsed.Nodes.Single(n => n.NodeType == "Index Scan");

        Assert.Equal("CTE recents", cte.SubplanName);
        Assert.True(cte.ParallelAware);
        Assert.Equal(2, cte.WorkersPlanned);
        Assert.False(cte.NeverExecuted);

        // Branche non atteinte : ni écart d'estimation ni avertissement, ses compteurs sont vides.
        Assert.True(skipped.NeverExecuted);
        Assert.Null(skipped.EstimationFactor);
        Assert.Empty(skipped.Warnings);
    }

    [Fact]
    public void BouclesMultipliantLeTempsCumule()
    {
        const string looped = """
            [{"Plan":{"Node Type":"Nested Loop","Total Cost":100.0,"Plan Rows":1,"Actual Total Time":50.0,"Actual Rows":1,"Actual Loops":1,
              "Plans":[{"Node Type":"Index Scan","Index Name":"idx","Total Cost":10.0,"Plan Rows":1,"Actual Total Time":0.01,"Actual Rows":1,"Actual Loops":1000}]}}]
            """;

        var plan = ExplainPlanParser.Parse(looped);
        var indexScan = plan.Nodes[1];

        // 0,01 ms par boucle sur 1000 boucles : 10 ms réellement passées.
        Assert.Equal(10, indexScan.InclusiveMs!.Value, 1);
        Assert.Equal(40, plan.Nodes[0].SelfMs!.Value, 1);
    }

    [Fact]
    public void PlanIllisibleLeveUneErreurExplicite()
    {
        Assert.Throws<InvalidOperationException>(() => ExplainPlanParser.Parse("""[{"pasDePlan":true}]"""));
    }
}
