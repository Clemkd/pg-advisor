using System.Net;
using System.Net.Http.Json;

namespace PgAdvisor.IntegrationTests;

/// <summary>Who may reach what. Everything below is deliberate, not incidental.</summary>
public enum Access
{
    /// <summary>Reachable without a session.</summary>
    Anonymous,

    /// <summary>Any signed-in account, Viewer included.</summary>
    Authenticated,

    /// <summary>Administrators only.</summary>
    Admin,
}

public sealed record Endpoint(string Method, string Path, Access Access, object? Body = null)
{
    public override string ToString() => $"{Method} {Path}";
}

/// <summary>
/// Freezes the authorization matrix of every endpoint. These tests assert only who is turned away,
/// never what the endpoint answers: a 400 or a 404 still counts as "reached it". Identifiers point
/// at rows that do not exist, so nothing is created or destroyed along the way.
/// </summary>
public class AuthorizationMatrixTests(AdvisorApplicationFactory factory)
    : IClassFixture<AdvisorApplicationFactory>
{
    private static readonly Endpoint[] All =
    [
        // --- Accounts -----------------------------------------------------------------------
        // Real credentials on purpose: invalid ones answer 401 too, and that business 401
        // would be indistinguishable from the one the pipeline returns to an anonymous caller.
        new("POST", "/api/auth/login", Access.Anonymous,
            new { username = "admin", password = AdvisorApplicationFactory.AdminPassword }),
        new("POST", "/api/auth/logout", Access.Anonymous),
        new("GET", "/api/auth/me", Access.Authenticated),
        new("POST", "/api/auth/password", Access.Authenticated,
            new { currentPassword = "wrong-one", newPassword = "another-one" }),
        new("GET", "/api/auth/users", Access.Admin),
        new("POST", "/api/auth/users", Access.Admin,
            new { username = "created-by-test", password = "a-long-enough-password", role = "Viewer" }),
        new("PATCH", "/api/auth/users/99999", Access.Admin, new { role = "Viewer" }),
        new("DELETE", "/api/auth/users/99999", Access.Admin),

        // --- Supervised instances -----------------------------------------------------------
        new("GET", "/api/connections", Access.Authenticated),
        new("GET", "/api/connections/99999", Access.Authenticated),
        new("GET", "/api/connections/99999/capabilities", Access.Authenticated),
        new("POST", "/api/connections", Access.Admin,
            new { name = "test", host = "localhost", port = 5432, database = "d", username = "u", password = "p" }),
        new("PUT", "/api/connections/99999", Access.Admin,
            new { name = "test", host = "localhost", port = 5432, database = "d", username = "u" }),
        new("DELETE", "/api/connections/99999", Access.Admin),
        new("POST", "/api/connections/test", Access.Admin,
            new { name = "test", host = "localhost", port = 5432, database = "d", username = "u", password = "p" }),

        // --- Dashboard ----------------------------------------------------------------------
        new("GET", "/api/dashboard", Access.Authenticated),

        // --- Diagnostics --------------------------------------------------------------------
        new("GET", "/api/findings", Access.Authenticated),
        new("GET", "/api/findings/summary", Access.Authenticated),
        new("GET", "/api/findings/99999", Access.Authenticated),
        new("POST", "/api/findings/99999/status", Access.Admin, new { status = "ignored" }),
        new("POST", "/api/findings/99999/verify", Access.Admin),

        // --- Webhooks -----------------------------------------------------------------------
        new("GET", "/api/notifications", Access.Authenticated),
        new("GET", "/api/notifications/history", Access.Authenticated),
        new("POST", "/api/notifications", Access.Admin,
            new { key = "test", url = "https://example.invalid/hook", format = "generic", minimumSeverity = "info", events = new[] { "new_finding" } }),
        new("PUT", "/api/notifications/99999", Access.Admin,
            new { key = "test", url = "https://example.invalid/hook", format = "generic", minimumSeverity = "info", events = new[] { "new_finding" } }),
        new("DELETE", "/api/notifications/99999", Access.Admin),
        new("POST", "/api/notifications/99999/test", Access.Admin),

        // --- Query study --------------------------------------------------------------------
        new("GET", "/api/queries", Access.Authenticated),
        new("GET", "/api/instances/99999/queries", Access.Authenticated),
        new("POST", "/api/instances/99999/queries/analyze", Access.Authenticated, new { sql = "SELECT 1" }),
        new("POST", "/api/instances/99999/queries/parameters", Access.Authenticated, new { sql = "SELECT 1" }),
        new("POST", "/api/instances/99999/queries/plan", Access.Authenticated, new { sql = "SELECT 1" }),

        // --- Rules --------------------------------------------------------------------------
        new("GET", "/api/rules", Access.Authenticated),
        new("GET", "/api/rules/health", Access.Authenticated),
        new("GET", "/api/rules/schema", Access.Authenticated),
        new("GET", "/api/rules/errors", Access.Authenticated),
        new("GET", "/api/rules/errors/nothing.yaml", Access.Authenticated),
        new("PUT", "/api/rules/errors/nothing.yaml", Access.Admin, new { yaml = "id: x" }),
        new("GET", "/api/rules/vacuum.dead-tuples", Access.Authenticated),
        new("POST", "/api/rules/validate", Access.Authenticated, new { yaml = "id: x" }),
        new("POST", "/api/rules", Access.Admin, new { yaml = "id: x" }),
        new("PUT", "/api/rules/vacuum.dead-tuples", Access.Admin, new { yaml = "id: x" }),
        new("DELETE", "/api/rules/does.not-exist", Access.Admin),
        new("POST", "/api/rules/reload", Access.Admin),
        new("POST", "/api/rules/does.not-exist/reactivate", Access.Admin, new { connectionId = (int?)null }),
        new("POST", "/api/rules/does.not-exist/dry-run", Access.Admin, new { connectionId = 99999 }),
        new("PUT", "/api/rules/does.not-exist/override", Access.Admin, new { enabled = true }),
        new("DELETE", "/api/rules/does.not-exist/override", Access.Admin),

        // --- Liveness -----------------------------------------------------------------------
        new("GET", "/api/health", Access.Anonymous),
    ];

    public static TheoryData<Endpoint> Endpoints()
    {
        var data = new TheoryData<Endpoint>();

        foreach (var endpoint in All)
        {
            data.Add(endpoint);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task AnonymousIsTurnedAwayUnlessTheEndpointIsPublic(Endpoint endpoint)
    {
        using var client = factory.CreateClient();
        using var response = await SendAsync(client, endpoint);

        if (endpoint.Access is Access.Anonymous)
        {
            Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        else
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task ViewerReachesEverythingButTheAdminEndpoints(Endpoint endpoint)
    {
        using var client = await factory.SignInAsViewerAsync();
        using var response = await SendAsync(client, endpoint);

        if (endpoint.Access is Access.Admin)
        {
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        else
        {
            Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task AdminIsNeverTurnedAway(Endpoint endpoint)
    {
        using var client = await factory.SignInAsAdminAsync();
        using var response = await SendAsync(client, endpoint);

        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, Endpoint endpoint)
    {
        var request = new HttpRequestMessage(new HttpMethod(endpoint.Method), endpoint.Path);

        if (endpoint.Body is not null)
        {
            request.Content = JsonContent.Create(endpoint.Body);
        }

        return client.SendAsync(request);
    }
}
