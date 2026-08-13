using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Services;

namespace PgAdvisor.Api.Controllers;

public sealed record AnalyzeQueryRequest
{
    /// <summary>SQL à analyser. Ignoré si <see cref="QueryId"/> est fourni.</summary>
    public string? Sql { get; init; }

    /// <summary>Identifiant pg_stat_statements : le texte normalisé est alors récupéré côté serveur.</summary>
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
                reason = "pg_stat_statements n'est pas installée sur cette instance : le classement des requêtes " +
                         "n'est pas disponible. Vous pouvez analyser une requête saisie manuellement.",
                items = Array.Empty<TopQuery>(),
            });
        }

        if (!QueryAnalysisService.SortKeys.Contains(sort, StringComparer.OrdinalIgnoreCase))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Critère de tri inconnu. Valeurs acceptées : {string.Join(", ", QueryAnalysisService.SortKeys)}.");
        }

        try
        {
            var items = await analysis.TopQueriesAsync(
                connection, sort.ToLowerInvariant(), limit, search, ct, includeAdvisor);
            return Ok(new { available = true, reason = (string?)null, items });
        }
        catch (PostgresException ex)
        {
            logger.LogWarning("Classement des requêtes impossible sur {Instance} : {Message}", connection.Name, ex.MessageText);
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
                title: "Indiquez au moins une instance.");
        }

        if (!QueryAnalysisService.SortKeys.Contains(sort, StringComparer.OrdinalIgnoreCase))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: $"Critère de tri inconnu. Valeurs acceptées : {string.Join(", ", QueryAnalysisService.SortKeys)}.");
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
                    Reason: (string?)"pg_stat_statements n'est pas installée sur cette instance.");
            }

            try
            {
                var items = await analysis.TopQueriesAsync(
                    connection, sortKey, bounded, search, ct, includeAdvisor);
                return (Connection: connection, Items: items, Reason: (string?)null);
            }
            catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
            {
                logger.LogWarning("Classement indisponible sur {Instance} : {Message}", connection.Name, ex.Message);
                return (Connection: connection, Items: (IReadOnlyList<TopQuery>)[],
                    Reason: (string?)(ex is PostgresException postgres ? postgres.MessageText : ex.Message));
            }
        });

        var results = await Task.WhenAll(reads);

        var items = results
            .SelectMany(result => result.Items)
            .OrderByDescending(query => QueryAnalysisService.SortScore(query, sortKey))
            .Take(bounded)
            .ToList();

        return Ok(new
        {
            available = results.Any(result => result.Reason is null),
            items,
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

        var sql = request.Sql;

        if (string.IsNullOrWhiteSpace(sql) && !string.IsNullOrWhiteSpace(request.QueryId))
        {
            sql = await ResolveQueryTextAsync(connection, request.QueryId!, ct);
            if (sql is null)
            {
                return Problem(statusCode: StatusCodes.Status404NotFound,
                    title: "Cette requête n'est plus présente dans pg_stat_statements.");
            }
        }

        if (string.IsNullOrWhiteSpace(sql))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "Fournissez une requête à analyser, ou l'identifiant d'une requête connue.");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromMinutes(2));

            var result = await analysis.ExplainAsync(
                connection, sql, request.Buffers, request.Parameters, timeout.Token);

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
                title: "L'analyse n'a pas abouti dans le délai imparti.", detail: ex.Message);
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
                title: "Fournissez une requête, ou l'identifiant d'une requête connue.");
        }

        try
        {
            var suggestions = await suggester.SuggestAsync(connection, sql, ct);
            return Ok(new { items = suggestions });
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or InvalidOperationException)
        {
            logger.LogWarning("Valeurs de paramètres non proposables sur {Instance} : {Message}",
                connection.Name, ex.Message);
            return Problem(statusCode: StatusCodes.Status502BadGateway,
                title: "Impossible de proposer des valeurs pour cette requête.", detail: ex.Message);
        }
    }

    private async Task<string?> ResolveQueryTextAsync(
        PostgresConnection connection, string queryId, CancellationToken ct)
    {
        var queries = await analysis.TopQueriesAsync(connection, "total_time", 200, null, ct);
        return queries.FirstOrDefault(q => q.QueryId == queryId)?.Query;
    }
}
