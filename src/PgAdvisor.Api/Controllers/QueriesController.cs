using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Services;

namespace PgAdvisor.Api.Controllers;

public static class QueryAnalysisLimits
{
    /// <summary>
    /// Bornes des entrées d'analyse. Sans elles, la seule limite est celle de Kestrel — trente
    /// mégaoctets — pour une requête que l'on va de toute façon envoyer à un EXPLAIN.
    /// </summary>
    public const int MaxSqlLength = 64 * 1024;

    public const int MaxParameters = 64;
    public const int MaxParameterLength = 4 * 1024;
}

public sealed record AnalyzeQueryRequest
{
    /// <summary>SQL à analyser. Ignoré si <see cref="QueryId"/> est fourni.</summary>
    [MaxLength(QueryAnalysisLimits.MaxSqlLength)]
    public string? Sql { get; init; }

    /// <summary>Identifiant pg_stat_statements : le texte normalisé est alors récupéré côté serveur.</summary>
    [MaxLength(64)]
    public string? QueryId { get; init; }

    /// <summary>Ajoute les compteurs de blocs (BUFFERS) au plan mesuré.</summary>
    public bool Buffers { get; init; } = true;

    /// <summary>Valeurs des paramètres $1, $2… d'une requête normalisée.</summary>
    public List<string>? Parameters { get; init; }
}

[ApiController]
[Route("api/instances/{connectionId:int}/queries")]
public sealed class QueriesController(
    AdvisorDbContext db,
    QueryAnalysisService analysis,
    QueryParameterSuggester suggester,
    ConnectionPresenter presenter,
    ILogger<QueriesController> logger) : ControllerBase
{
    /// <summary>Classement des requêtes de l'instance, selon le critère demandé.</summary>
    [HttpGet]
    public async Task<ActionResult> List(
        int connectionId,
        [FromQuery] string sort = "total_time",
        [FromQuery] int limit = 25,
        [FromQuery] string? search = null,
        [FromQuery] bool includeAdvisor = false,
        CancellationToken ct = default)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == connectionId, ct);
        if (connection is null)
        {
            return NotFound();
        }

        var capabilities = presenter.CapabilitiesFor(connection);
        if (capabilities is not null && !capabilities.HasExtension("pg_stat_statements"))
        {
            // Cas normal, pas une erreur : l'interface propose alors l'analyse d'une requête saisie.
            return Ok(new
            {
                available = false,
                reason = "pg_stat_statements is not installed on this instance: the query ranking is not " +
                         "available. You can still analyze a query you type in manually.",
                items = Array.Empty<TopQuery>(),
            });
        }

        if (!QueryAnalysisService.SortKeys.Contains(sort, StringComparer.OrdinalIgnoreCase))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown sort key. Accepted values: {string.Join(", ", QueryAnalysisService.SortKeys)}.");
        }

        try
        {
            var items = await analysis.TopQueriesAsync(
                connection, sort.ToLowerInvariant(), limit, search, ct, includeAdvisor);
            return Ok(new { available = true, reason = (string?)null, items = await MarkSavedPlansAsync(items, ct) });
        }
        catch (PostgresException ex)
        {
            logger.LogWarning("Cannot rank queries on {Instance}: {Message}", connection.Name, ex.MessageText);
            return Ok(new { available = false, reason = ex.MessageText, items = Array.Empty<TopQuery>() });
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
        {
            return Problem(statusCode: StatusCodes.Status502BadGateway, title: ex.Message);
        }
    }

    /// <summary>
    /// Classement fusionné de plusieurs instances : chacune est interrogée en parallèle, et le
    /// même critère de tri est rejoué sur l'ensemble. Une instance en échec ne prive pas
    /// l'opérateur des autres : son état est renvoyé à côté des résultats.
    /// </summary>
    [HttpGet("/api/queries")]
    public async Task<ActionResult> ListAcross(
        [FromQuery] string connectionIds = "",
        [FromQuery] string sort = "total_time",
        [FromQuery] int limit = 25,
        [FromQuery] string? search = null,
        [FromQuery] bool includeAdvisor = false,
        CancellationToken ct = default)
    {
        var requested = connectionIds
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(value => int.TryParse(value, out var id) ? id : (int?)null)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        if (requested.Count == 0)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Specify at least one instance.");
        }

        if (!QueryAnalysisService.SortKeys.Contains(sort, StringComparer.OrdinalIgnoreCase))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Unknown sort key. Accepted values: {string.Join(", ", QueryAnalysisService.SortKeys)}.");
        }

        var connections = await db.PostgresConnections
            .Where(c => requested.Contains(c.Id))
            .ToListAsync(ct);

        var sortKey = sort.ToLowerInvariant();
        var bounded = Math.Clamp(limit, 1, 200);

        // Chaque instance est lue pour le classement complet : la fusion ne peut pas retenir
        // une requête qu'une instance n'aurait pas remontée.
        var reads = connections.Select(async connection =>
        {
            var capabilities = presenter.CapabilitiesFor(connection);
            if (capabilities is not null && !capabilities.HasExtension("pg_stat_statements"))
            {
                return (Connection: connection, Items: (IReadOnlyList<TopQuery>)[],
                    Reason: (string?)"pg_stat_statements is not installed on this instance.");
            }

            try
            {
                var items = await analysis.TopQueriesAsync(
                    connection, sortKey, bounded, search, ct, includeAdvisor);
                return (Connection: connection, Items: items, Reason: (string?)null);
            }
            catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
            {
                logger.LogWarning("Ranking unavailable on {Instance}: {Message}", connection.Name, ex.Message);
                return (Connection: connection, Items: (IReadOnlyList<TopQuery>)[],
                    Reason: (string?)(ex is PostgresException postgres ? postgres.MessageText : ex.Message));
            }
        });

        var results = await Task.WhenAll(reads);

        var ranked = results
            .SelectMany(result => result.Items)
            .OrderByDescending(query => QueryAnalysisService.SortScore(query, sortKey))
            .Take(bounded)
            .ToList();

        return Ok(new
        {
            available = results.Any(result => result.Reason is null),
            items = await MarkSavedPlansAsync(ranked, ct),
            instances = results.Select(result => new
            {
                id = result.Connection.Id,
                name = result.Connection.Name,
                available = result.Reason is null,
                reason = result.Reason,
                count = result.Items.Count,
            }),
        });
    }

    /// <summary>
    /// Produit le plan d'exécution mesuré d'une requête (EXPLAIN ANALYZE), à la demande.
    /// </summary>
    [HttpPost("analyze")]
    public async Task<ActionResult<QueryAnalysisResult>> Analyze(
        int connectionId, AnalyzeQueryRequest request, CancellationToken ct)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == connectionId, ct);
        if (connection is null)
        {
            return NotFound();
        }

        if (TooManyParameters(request.Parameters) is { } tooMany)
        {
            return tooMany;
        }

        var sql = request.Sql;

        if (string.IsNullOrWhiteSpace(sql) && !string.IsNullOrWhiteSpace(request.QueryId))
        {
            sql = await ResolveQueryTextAsync(connection, request.QueryId!, ct);
            if (sql is null)
            {
                return Problem(statusCode: StatusCodes.Status404NotFound,
                    title: "This query is no longer present in pg_stat_statements.");
            }
        }

        if (string.IsNullOrWhiteSpace(sql))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Provide a query to analyze, or the identifier of a known query.");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromMinutes(2));

            var result = await analysis.ExplainAsync(
                connection, sql, request.Buffers, request.Parameters, timeout.Token);

            // Une mesure réussie est conservée : la relire ne doit plus coûter une exécution.
            await SaveAsync(connectionId, request, sql, result, ct);

            return Ok(result);
        }
        catch (MissingQueryParametersException ex)
        {
            // 422 : la requête est valide, il manque seulement les valeurs que l'IHM va demander.
            return UnprocessableEntity(new
            {
                title = ex.Message,
                requiredParameters = ex.Required,
                sql,
            });
        }
        catch (PostgresException ex)
        {
            // Erreur SQL côté instance : elle est utile à l'opérateur, on la renvoie telle quelle.
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"{ex.SqlState} : {ex.MessageText}",
                detail: ex.Hint ?? ex.Detail);
        }
        catch (InvalidOperationException ex)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: ex.Message);
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or OperationCanceledException)
        {
            return Problem(statusCode: StatusCodes.Status504GatewayTimeout,
                title: "The analysis did not complete within the allotted time.", detail: ex.Message);
        }
    }

    /// <summary>
    /// Propose, pour chaque paramètre d'une requête normalisée, une valeur tirée de la base :
    /// la valeur la plus fréquente connue du planificateur, à défaut une valeur existante.
    /// </summary>
    [HttpPost("parameters")]
    public async Task<ActionResult> SuggestParameters(
        int connectionId, AnalyzeQueryRequest request, CancellationToken ct)
    {
        var connection = await db.PostgresConnections.FirstOrDefaultAsync(c => c.Id == connectionId, ct);
        if (connection is null)
        {
            return NotFound();
        }

        var sql = request.Sql;

        if (string.IsNullOrWhiteSpace(sql) && !string.IsNullOrWhiteSpace(request.QueryId))
        {
            sql = await ResolveQueryTextAsync(connection, request.QueryId!, ct);
        }

        if (string.IsNullOrWhiteSpace(sql))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Provide a query, or the identifier of a known query.");
        }

        try
        {
            var suggestions = await suggester.SuggestAsync(connection, sql, ct);
            return Ok(new { items = suggestions });
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
        {
            logger.LogWarning("Cannot suggest parameter values on {Instance}: {Message}",
                connection.Name, ex.Message);
            return Problem(statusCode: StatusCodes.Status502BadGateway,
                title: "Cannot suggest values for this query.", detail: ex.Message);
        }
    }

    /// <summary>
    /// Dernier plan mesuré conservé pour cette requête, sans rien exécuter sur l'instance.
    /// C'est ce que l'interface lit à l'ouverture d'une analyse.
    ///
    /// En POST alors qu'il s'agit d'une lecture : la requête à identifier peut faire plusieurs
    /// kilo-octets, ce qu'une chaîne de requête ne transporte pas de façon fiable. Les deux
    /// autres points d'entrée de ce contrôleur prennent déjà le même corps.
    /// </summary>
    [HttpPost("plan")]
    public async Task<ActionResult<QueryAnalysisResult>> SavedPlan(
        int connectionId, AnalyzeQueryRequest request, CancellationToken ct)
    {
        var key = QueryKeyFor(request);
        if (key is null)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Provide a query, or the identifier of a known query.");
        }

        var snapshot = await db.QueryPlanSnapshots
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.ConnectionId == connectionId && s.QueryKey == key, ct);

        if (snapshot is null)
        {
            return NotFound();
        }

        return Ok(Restore(snapshot));
    }

    /// <summary>
    /// Reconstitue un résultat d'analyse à partir du plan conservé. Le JSON est reparsé plutôt
    /// que stocké déjà structuré : le parseur reste l'unique chemin vers la vue du plan, et une
    /// amélioration de son analyse profite aux plans déjà enregistrés.
    /// </summary>
    private QueryAnalysisResult Restore(QueryPlanSnapshot snapshot)
    {
        ExplainPlan plan;
        var notes = new List<AnalysisNote>();

        try
        {
            plan = ExplainPlanParser.Parse(snapshot.PlanJson);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            logger.LogWarning(ex, "Stored plan {Id} could not be parsed.", snapshot.Id);
            plan = new ExplainPlan();
            notes.Add(new AnalysisNote(
                AnalysisNotes.PlanNotParsed,
                "The JSON plan could not be parsed; only the text view is available."));
        }

        return new QueryAnalysisResult
        {
            Sql = snapshot.Sql,
            PlanText = snapshot.PlanText,
            PlanJson = snapshot.PlanJson,
            Plan = plan,
            Notes = notes,
            MeasuredAt = snapshot.MeasuredAt,
            DurationMs = snapshot.DurationMs,
            Parameters = ReadParameters(snapshot.ParametersJson),
            FromStorage = true,
        };
    }

    private static IReadOnlyList<string> ReadParameters(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>Écrit — ou remplace — le plan conservé pour cette requête sur cette instance.</summary>
    private async Task SaveAsync(
        int connectionId,
        AnalyzeQueryRequest request,
        string sql,
        QueryAnalysisResult result,
        CancellationToken ct)
    {
        var key = QueryKeyFor(request) ?? HashOf(sql);

        var snapshot = await db.QueryPlanSnapshots
            .FirstOrDefaultAsync(s => s.ConnectionId == connectionId && s.QueryKey == key, ct);

        if (snapshot is null)
        {
            snapshot = new QueryPlanSnapshot { ConnectionId = connectionId, QueryKey = key };
            db.QueryPlanSnapshots.Add(snapshot);
        }

        snapshot.QueryId = string.IsNullOrWhiteSpace(request.QueryId) ? null : request.QueryId;
        snapshot.Sql = result.Sql;
        snapshot.ParametersJson = result.Parameters.Count == 0
            ? null
            : JsonSerializer.Serialize(result.Parameters);
        snapshot.PlanJson = result.PlanJson;
        snapshot.PlanText = result.PlanText;
        snapshot.MeasuredAt = result.MeasuredAt;
        snapshot.DurationMs = result.DurationMs;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            // Conserver le plan est un service rendu, pas une condition de l'analyse : un échec
            // d'écriture ne doit pas priver l'opérateur du plan qu'il vient de mesurer.
            logger.LogWarning(ex, "The measured plan could not be stored for instance {Instance}.", connectionId);
        }
    }

    /// <summary>
    /// Identité de la requête dans la table des plans : le queryid quand il est connu, sinon une
    /// empreinte du texte. Deux analyses de la même requête se retrouvent ainsi, quelles que
    /// soient les valeurs de paramètres essayées entre-temps.
    /// </summary>
    private static string? QueryKeyFor(AnalyzeQueryRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.QueryId))
        {
            return request.QueryId.Trim();
        }

        return string.IsNullOrWhiteSpace(request.Sql) ? null : HashOf(request.Sql);
    }

    private static string HashOf(string sql)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(sql.Trim()));
        return "sql:" + Convert.ToHexStringLower(digest)[..32];
    }

    /// <summary>
    /// Signale les requêtes dont un plan est déjà conservé. Une seule lecture pour tout le
    /// classement : la liste peut compter deux cents entrées réparties sur plusieurs instances.
    /// </summary>
    private async Task<IReadOnlyList<TopQuery>> MarkSavedPlansAsync(
        IReadOnlyList<TopQuery> items, CancellationToken ct)
    {
        if (items.Count == 0)
        {
            return items;
        }

        var keys = items.Select(item => item.QueryId).Distinct().ToList();
        var connectionIds = items.Select(item => item.ConnectionId).Distinct().ToList();

        var stored = await db.QueryPlanSnapshots
            .AsNoTracking()
            .Where(s => connectionIds.Contains(s.ConnectionId) && keys.Contains(s.QueryKey))
            .Select(s => new { s.ConnectionId, s.QueryKey })
            .ToListAsync(ct);

        if (stored.Count == 0)
        {
            return items;
        }

        var known = stored.Select(s => (s.ConnectionId, s.QueryKey)).ToHashSet();

        return items
            .Select(item => known.Contains((item.ConnectionId, item.QueryId))
                ? item with { HasSavedPlan = true }
                : item)
            .ToList();
    }

    /// <summary>
    /// MaxLength ne sait valider qu'une chaîne ou un tableau : la cardinalité d'une liste et la
    /// taille de chaque valeur se vérifient ici, avant qu'elles ne partent dans le SQL analysé.
    /// </summary>
    private ActionResult? TooManyParameters(List<string>? parameters)
    {
        if (parameters is null)
        {
            return null;
        }

        if (parameters.Count > QueryAnalysisLimits.MaxParameters)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"At most {QueryAnalysisLimits.MaxParameters} parameter values are accepted.");
        }

        if (parameters.Any(value => value.Length > QueryAnalysisLimits.MaxParameterLength))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"A parameter value cannot exceed {QueryAnalysisLimits.MaxParameterLength} characters.");
        }

        return null;
    }

    private async Task<string?> ResolveQueryTextAsync(
        PostgresConnection connection, string queryId, CancellationToken ct)
    {
        var queries = await analysis.TopQueriesAsync(connection, "total_time", 200, null, ct);
        return queries.FirstOrDefault(q => q.QueryId == queryId)?.Query;
    }
}
