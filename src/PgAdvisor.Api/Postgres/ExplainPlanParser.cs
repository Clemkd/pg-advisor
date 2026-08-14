using System.Globalization;
using System.Text.Json;

namespace PgAdvisor.Api.Postgres;

/// <summary>Nœud de plan aplati, enrichi des métriques que PostgreSQL ne fournit pas directement.</summary>
public sealed record PlanNode
{
    public int Id { get; init; }
    public int? ParentId { get; init; }
    public int Depth { get; init; }

    public string NodeType { get; init; } = string.Empty;

    /// <summary>« Outer », « Inner », « Subquery »… tel que rapporté par PostgreSQL.</summary>
    public string? ParentRelationship { get; init; }

    /// <summary>Nom du sous-plan porté par le nœud : « CTE recents », « InitPlan 1 »…</summary>
    public string? SubplanName { get; init; }

    public string? RelationName { get; init; }
    public string? Alias { get; init; }
    public string? IndexName { get; init; }
    public string? JoinType { get; init; }
    public string? ScanDirection { get; init; }
    public string? Filter { get; init; }
    public string? IndexCondition { get; init; }
    public string? RecheckCondition { get; init; }
    public string? HashCondition { get; init; }
    public string? JoinFilter { get; init; }
    public string? SortKey { get; init; }
    public string? SortMethod { get; init; }
    public string? GroupKey { get; init; }

    public double StartupCost { get; init; }
    public double TotalCost { get; init; }
    public double PlanRows { get; init; }
    public int PlanWidth { get; init; }

    // Renseignés uniquement avec EXPLAIN ANALYZE.
    public double? ActualStartupMs { get; init; }
    public double? ActualTotalMs { get; init; }
    public double? ActualRows { get; init; }
    public double? ActualLoops { get; init; }
    public double? RowsRemovedByFilter { get; init; }
    public double? HeapFetches { get; init; }

    /// <summary>Temps cumulé, boucles comprises : c'est la durée réellement passée dans ce sous-arbre.</summary>
    public double? InclusiveMs { get; init; }

    /// <summary>Temps propre au nœud, hors enfants : la métrique qui désigne le vrai coupable.</summary>
    public double? SelfMs { get; init; }

    public double? SelfSharePercent { get; init; }
    public double CostSharePercent { get; init; }

    /// <summary>Rapport entre lignes réelles et lignes estimées ; 1 = estimation juste.</summary>
    public double? EstimationFactor { get; init; }

    public long? SharedHitBlocks { get; init; }
    public long? SharedReadBlocks { get; init; }
    public long? SharedDirtiedBlocks { get; init; }
    public long? SharedWrittenBlocks { get; init; }
    public long? TempReadBlocks { get; init; }
    public long? TempWrittenBlocks { get; init; }
    public long? SortSpaceUsedKb { get; init; }
    public string? SortSpaceType { get; init; }
    public int? WorkersPlanned { get; init; }
    public int? WorkersLaunched { get; init; }

    /// <summary>Le nœud participe à un parcours parallèle.</summary>
    public bool ParallelAware { get; init; }

    /// <summary>Branche jamais atteinte à l'exécution : ses compteurs ne veulent rien dire.</summary>
    public bool NeverExecuted { get; init; }

    public IReadOnlyList<PlanWarning> Warnings { get; init; } = [];

    /// <summary>Libellé synthétique : « Seq Scan — public.commandes ».</summary>
    public string Label
    {
        get
        {
            var target = RelationName is null
                ? null
                : Alias is not null && Alias != RelationName
                    ? $"{RelationName} ({Alias})"
                    : RelationName;

            if (IndexName is not null)
            {
                target = target is null ? IndexName : $"{IndexName} on {target}";
            }

            return target is null ? NodeType : $"{NodeType} — {target}";
        }
    }
}

public sealed record PlanWarning(string Kind, string Severity, string Message);

public sealed record ExplainPlan
{
    public IReadOnlyList<PlanNode> Nodes { get; init; } = [];
    public double? PlanningMs { get; init; }
    public double? ExecutionMs { get; init; }
    public double TotalCost { get; init; }
    public bool Analyzed { get; init; }

    /// <summary>Paramètres non standard actifs pendant la planification (EXPLAIN SETTINGS).</summary>
    public Dictionary<string, string> Settings { get; init; } = [];

    public IReadOnlyList<PlanWarning> Warnings { get; init; } = [];
}

/// <summary>
/// Transforme la sortie JSON d'EXPLAIN en liste de nœuds exploitable par l'interface, en
/// calculant ce que PostgreSQL ne donne pas : temps propre, part relative, écart d'estimation.
/// </summary>
public static class ExplainPlanParser
{
    private const double BadEstimateFactor = 10;
    private const double SelfTimeShareAlert = 0.3;
    private const long LargeSeqScanRows = 100_000;

    public static ExplainPlan Parse(string json)
    {
        using var document = JsonDocument.Parse(json);

        var root = document.RootElement.ValueKind == JsonValueKind.Array
            ? document.RootElement[0]
            : document.RootElement;

        if (!root.TryGetProperty("Plan", out var planElement))
        {
            throw new InvalidOperationException("Unexpected JSON plan: the \"Plan\" property is missing.");
        }

        var nodes = new List<PlanNode>();
        var nextId = 0;
        var rootTotalCost = ReadDouble(planElement, "Total Cost") ?? 0;

        // Première passe : aplatissement de l'arbre, temps inclusif par nœud.
        var inclusive = new Dictionary<int, double?>();
        Flatten(planElement, null, 0, ref nextId, nodes, inclusive);

        var executionMs = ReadDouble(root, "Execution Time");
        var analyzed = nodes.Any(n => n.ActualTotalMs is not null);

        // Seconde passe : temps propre, parts relatives, avertissements.
        var childrenInclusive = nodes
            .Where(n => n.ParentId is not null)
            .GroupBy(n => n.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(n => inclusive.GetValueOrDefault(n.Id) ?? 0));

        var totalSelf = 0d;
        var enriched = new List<PlanNode>(nodes.Count);

        foreach (var node in nodes)
        {
            var nodeInclusive = inclusive.GetValueOrDefault(node.Id);
            double? self = nodeInclusive is null
                ? null
                : Math.Max(0, nodeInclusive.Value - childrenInclusive.GetValueOrDefault(node.Id));

            totalSelf += self ?? 0;

            enriched.Add(node with
            {
                InclusiveMs = nodeInclusive,
                SelfMs = self,
                CostSharePercent = rootTotalCost > 0 ? node.TotalCost / rootTotalCost * 100 : 0,
                EstimationFactor = EstimationFactor(node),
            });
        }

        var reference = executionMs is > 0 ? executionMs.Value : totalSelf;

        var final = enriched
            .Select(node => node with
            {
                SelfSharePercent = node.SelfMs is null || reference <= 0
                    ? null
                    : node.SelfMs.Value / reference * 100,
            })
            .Select(node => node with { Warnings = BuildWarnings(node) })
            .ToList();

        return new ExplainPlan
        {
            Nodes = final,
            PlanningMs = ReadDouble(root, "Planning Time"),
            ExecutionMs = executionMs,
            TotalCost = rootTotalCost,
            Analyzed = analyzed,
            Settings = ReadSettings(root),
            Warnings = final.SelectMany(n => n.Warnings).ToList(),
        };
    }

    private static void Flatten(
        JsonElement element,
        int? parentId,
        int depth,
        ref int nextId,
        List<PlanNode> nodes,
        Dictionary<int, double?> inclusive)
    {
        var id = nextId++;
        var loops = ReadDouble(element, "Actual Loops");
        var totalMs = ReadDouble(element, "Actual Total Time");

        var node = new PlanNode
        {
            Id = id,
            ParentId = parentId,
            Depth = depth,
            NodeType = ReadString(element, "Node Type") ?? "?",
            ParentRelationship = ReadString(element, "Parent Relationship"),
            SubplanName = ReadString(element, "Subplan Name"),
            RelationName = Qualify(ReadString(element, "Schema"), ReadString(element, "Relation Name")),
            Alias = ReadString(element, "Alias"),
            IndexName = ReadString(element, "Index Name"),
            JoinType = ReadString(element, "Join Type"),
            ScanDirection = ReadString(element, "Scan Direction"),
            Filter = ReadString(element, "Filter"),
            IndexCondition = ReadString(element, "Index Cond"),
            RecheckCondition = ReadString(element, "Recheck Cond"),
            HashCondition = ReadString(element, "Hash Cond"),
            JoinFilter = ReadString(element, "Join Filter"),
            SortKey = ReadArray(element, "Sort Key"),
            SortMethod = ReadString(element, "Sort Method"),
            GroupKey = ReadArray(element, "Group Key"),
            StartupCost = ReadDouble(element, "Startup Cost") ?? 0,
            TotalCost = ReadDouble(element, "Total Cost") ?? 0,
            PlanRows = ReadDouble(element, "Plan Rows") ?? 0,
            PlanWidth = (int)(ReadDouble(element, "Plan Width") ?? 0),
            ActualStartupMs = ReadDouble(element, "Actual Startup Time"),
            ActualTotalMs = totalMs,
            ActualRows = ReadDouble(element, "Actual Rows"),
            ActualLoops = loops,
            RowsRemovedByFilter = ReadDouble(element, "Rows Removed by Filter"),
            HeapFetches = ReadDouble(element, "Heap Fetches"),
            SharedHitBlocks = ReadLong(element, "Shared Hit Blocks"),
            SharedReadBlocks = ReadLong(element, "Shared Read Blocks"),
            SharedDirtiedBlocks = ReadLong(element, "Shared Dirtied Blocks"),
            SharedWrittenBlocks = ReadLong(element, "Shared Written Blocks"),
            TempReadBlocks = ReadLong(element, "Temp Read Blocks"),
            TempWrittenBlocks = ReadLong(element, "Temp Written Blocks"),
            SortSpaceUsedKb = ReadLong(element, "Sort Space Used"),
            SortSpaceType = ReadString(element, "Sort Space Type"),
            WorkersPlanned = (int?)ReadDouble(element, "Workers Planned"),
            WorkersLaunched = (int?)ReadDouble(element, "Workers Launched"),
            ParallelAware = ReadBool(element, "Parallel Aware") ?? false,
            // PostgreSQL signale une branche non atteinte par « Never Executed », et se contente
            // parfois d'un compteur de boucles à zéro.
            NeverExecuted = ReadBool(element, "Never Executed") ?? loops is 0,
        };

        nodes.Add(node);

        // Le temps rapporté est par boucle : la durée réelle du sous-arbre le multiplie.
        inclusive[id] = totalMs is null ? null : totalMs.Value * Math.Max(1, loops ?? 1);

        if (element.TryGetProperty("Plans", out var children) && children.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in children.EnumerateArray())
            {
                Flatten(child, id, depth + 1, ref nextId, nodes, inclusive);
            }
        }
    }

    private static double? EstimationFactor(PlanNode node)
    {
        // Une branche jamais atteinte n'a pas de lignes à comparer : l'écart serait un artefact.
        if (node.ActualRows is null || node.NeverExecuted)
        {
            return null;
        }

        // Les lignes réelles sont rapportées par boucle, comme les lignes estimées.
        var actual = node.ActualRows.Value;
        var planned = node.PlanRows;

        if (planned <= 0 && actual <= 0)
        {
            return 1;
        }

        if (planned <= 0)
        {
            return actual;
        }

        return actual >= planned ? actual / planned : -(planned / Math.Max(actual, 1));
    }

    private static IReadOnlyList<PlanWarning> BuildWarnings(PlanNode node)
    {
        if (node.NeverExecuted)
        {
            return [];
        }

        var warnings = new List<PlanWarning>();

        if (node.NodeType.Contains("Seq Scan", StringComparison.Ordinal) &&
            (node.ActualRows ?? node.PlanRows) > LargeSeqScanRows)
        {
            warnings.Add(new PlanWarning(
                "seq-scan",
                "warning",
                $"Sequential scan over a large {node.RelationName ?? "relation"}: a targeted index would avoid reading it in full."));
        }

        if (node.EstimationFactor is { } factor && Math.Abs(factor) >= BadEstimateFactor)
        {
            var direction = factor > 0 ? "underestimated" : "overestimated";
            warnings.Add(new PlanWarning(
                "bad-estimate",
                "warning",
                $"Row count {direction} by a factor of {Math.Abs(factor):0.#}: fresh or extended statistics would fix the plan."));
        }

        if (node.SelfSharePercent is > SelfTimeShareAlert * 100)
        {
            warnings.Add(new PlanWarning(
                "hotspot",
                "info",
                $"This node accounts for {node.SelfSharePercent:0.#}% of the execution time."));
        }

        if (node.SortSpaceType is not null &&
            node.SortSpaceType.Contains("Disk", StringComparison.OrdinalIgnoreCase))
        {
            warnings.Add(new PlanWarning(
                "sort-on-disk",
                "warning",
                $"Sort spilled to disk ({node.SortSpaceUsedKb} kB): work_mem is too small for this query."));
        }

        if (node.TempWrittenBlocks is > 0)
        {
            warnings.Add(new PlanWarning(
                "temp-blocks",
                "info",
                $"{node.TempWrittenBlocks} temporary blocks written: the operation spilled out of working memory."));
        }

        if (node.NodeType == "Nested Loop" && node.ActualLoops is > 10_000)
        {
            warnings.Add(new PlanWarning(
                "many-loops",
                "warning",
                $"{node.ActualLoops:0} nested loop iterations: a hash join would most likely be more efficient."));
        }

        if (node.HeapFetches is > 100_000)
        {
            warnings.Add(new PlanWarning(
                "heap-fetches",
                "info",
                $"{node.HeapFetches:0} heap fetches from an index only scan: the visibility map is stale, a VACUUM would help."));
        }

        return warnings;
    }

    private static string? Qualify(string? schema, string? relation) =>
        relation is null ? null : schema is null or "public" ? relation : $"{schema}.{relation}";

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? ReadArray(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var parts = value.EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
            .Where(part => !string.IsNullOrEmpty(part));

        var joined = string.Join(", ", parts);
        return string.IsNullOrEmpty(joined) ? null : joined;
    }

    private static double? ReadDouble(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.GetDouble(),
            JsonValueKind.String when double.TryParse(
                value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null,
        };
    }

    private static bool? ReadBool(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null,
            }
            : null;

    private static long? ReadLong(JsonElement element, string name)
    {
        var value = ReadDouble(element, name);
        return value is null ? null : (long)value.Value;
    }

    private static Dictionary<string, string> ReadSettings(JsonElement root)
    {
        var settings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (root.TryGetProperty("Settings", out var element) && element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                settings[property.Name] = property.Value.ValueKind == JsonValueKind.String
                    ? property.Value.GetString() ?? string.Empty
                    : property.Value.ToString();
            }
        }

        return settings;
    }
}
