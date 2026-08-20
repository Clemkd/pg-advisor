using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Security;

namespace PgAdvisor.IntegrationTests;

/// <summary>
/// Boots the real application over a throwaway data directory. Nothing is mocked: the pipeline,
/// the authorization policies and the controllers are the ones that ship.
/// </summary>
/// <remarks>
/// Settings travel as PGADVISOR_ environment variables rather than through
/// ConfigureAppConfiguration. Program.cs reads a snapshot of its configuration — for the data
/// directory, the database path and the rate limiting ceiling — before WebApplicationFactory gets
/// a chance to add a source, so an in-memory collection arrives too late for those. The
/// environment source is registered by Program.cs itself, which makes it the only hook early
/// enough; it is also exactly how the container is configured in production.
///
/// Those variables are process-wide, so the assembly disables test parallelisation. Two factories
/// alive at once would otherwise share one data directory — which is precisely the bug this
/// replaced: every suite was silently writing to the same SQLite file under bin/.
/// </remarks>
public class AdvisorApplicationFactory : WebApplicationFactory<Program>
{
    public const string AdminPassword = "integration-admin-pw";
    public const string ViewerPassword = "integration-viewer-pw";

    private readonly string _dataDirectory =
        Path.Combine(Path.GetTempPath(), "pg-advisor-tests", Guid.NewGuid().ToString("n"));

    private readonly Dictionary<string, string?> _restore = [];

    protected AdvisorApplicationFactory()
    {
        Directory.CreateDirectory(Path.Combine(_dataDirectory, "bundled-rules"));

        foreach (var (key, value) in Settings())
        {
            // Nesting is a double underscore in an environment variable name.
            var variable = "PGADVISOR_" + key.Replace(":", "__", StringComparison.Ordinal);
            _restore[variable] = Environment.GetEnvironmentVariable(variable);
            Environment.SetEnvironmentVariable(variable, value);
        }
    }

    /// <summary>Configuration of the booted application. Override to change one setting.</summary>
    protected virtual Dictionary<string, string?> Settings() => new()
    {
        ["DataDirectory"] = _dataDirectory,
        ["RulesDirectory"] = Path.Combine(_dataDirectory, "bundled-rules"),
        // No supervised instance in these tests: the scheduler would only add noise.
        ["Scheduler:Enabled"] = "false",
        // The suite signs in once per case, from a single client address: the shipped ceiling
        // would throttle the tests themselves. LoginRateLimitTests sets its own.
        ["Auth:LoginAttemptsPerWindow"] = "100000",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Production");

        builder.ConfigureServices(services =>
        {
            // The initializer migrates from a hosted service, so it races with the first request.
            // The accounts are seeded explicitly below instead, before the host is handed over.
            var initializer = services.SingleOrDefault(descriptor =>
                descriptor.ServiceType == typeof(IHostedService) &&
                descriptor.ImplementationType == typeof(DatabaseInitializer));

            if (initializer is not null)
            {
                services.Remove(initializer);
            }
        });
    }

    /// <summary>Migrates and seeds the two accounts once, before the first request is served.</summary>
    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);

        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();
        db.Database.Migrate();

        // The factory builds the host more than once over its lifetime, against the same SQLite
        // file: seeding has to be idempotent or the second pass trips the unique index.
        Seed(db, "admin", AdminPassword, Roles.Admin);
        Seed(db, "viewer", ViewerPassword, Roles.Viewer);

        db.SaveChanges();

        return host;
    }

    private static void Seed(AdvisorDbContext db, string username, string password, string role)
    {
        if (db.Users.Any(user => user.Username == username))
        {
            return;
        }

        db.Users.Add(new User
        {
            Username = username,
            PasswordHash = PasswordHasher.Hash(password),
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
    }

    /// <summary>A client already carrying the session cookie of the requested account.</summary>
    public async Task<HttpClient> SignInAsync(string username, string password)
    {
        var client = CreateClient();
        using var response = await client.PostAsJsonAsync("/api/auth/login", new { username, password });
        response.EnsureSuccessStatusCode();
        return client;
    }

    public Task<HttpClient> SignInAsAdminAsync() => SignInAsync("admin", AdminPassword);

    public Task<HttpClient> SignInAsViewerAsync() => SignInAsync("viewer", ViewerPassword);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (!disposing)
        {
            return;
        }

        foreach (var (variable, value) in _restore)
        {
            Environment.SetEnvironmentVariable(variable, value);
        }

        try
        {
            Directory.Delete(_dataDirectory, recursive: true);
        }
        catch (IOException)
        {
            // SQLite may still hold the file on Windows: a leftover temp directory is harmless.
        }
    }
}

/// <summary>The default factory, for the suites that need no particular setting.</summary>
public sealed class DefaultApplicationFactory : AdvisorApplicationFactory;
