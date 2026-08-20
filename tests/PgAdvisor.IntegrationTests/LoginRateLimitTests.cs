using System.Net;
using System.Net.Http.Json;

namespace PgAdvisor.IntegrationTests;

/// <summary>Boots the application with a deliberately tiny sign-in ceiling.</summary>
public sealed class ThrottledLoginFactory : AdvisorApplicationFactory
{
    public const int PermitLimit = 3;

    protected override Dictionary<string, string?> Settings()
    {
        var settings = base.Settings();
        settings["Auth:LoginAttemptsPerWindow"] = PermitLimit.ToString();
        // Long enough that no test ever waits for the window to roll over.
        settings["Auth:LoginAttemptWindow"] = "00:05:00";
        return settings;
    }
}

/// <summary>
/// Shared plumbing. Each suite below gets its own factory, hence its own limiter: the partition
/// key is the client address, and every test speaks to the server from the same one, so two
/// scenarios in a single class would share one window and the second would start out saturated.
/// </summary>
public abstract class LoginRateLimitSuite(ThrottledLoginFactory factory)
{
    protected ThrottledLoginFactory Factory { get; } = factory;

    protected static Task<HttpResponseMessage> AttemptAsync(HttpClient client, string password) =>
        client.PostAsJsonAsync("/api/auth/login", new { username = "admin", password });
}

/// <summary>
/// Passwords are hashed with 210 000 PBKDF2 iterations, so an unthrottled sign-in route costs the
/// server far more than it costs the caller: it is a CPU denial of service as much as it is an
/// open door to brute force.
/// </summary>
public class LoginRateLimitTests(ThrottledLoginFactory factory)
    : LoginRateLimitSuite(factory), IClassFixture<ThrottledLoginFactory>
{
    [Fact]
    public async Task RepeatedAttemptsAreTurnedAwayWith429()
    {
        using var client = Factory.CreateClient();
        var statuses = new List<HttpStatusCode>();

        // One more than the ceiling: the last one has to be refused by the limiter rather than by
        // the credentials check, and 429 is the only status that says so.
        for (var attempt = 0; attempt <= ThrottledLoginFactory.PermitLimit; attempt++)
        {
            using var response = await AttemptAsync(client, "not-the-password");
            statuses.Add(response.StatusCode);
        }

        Assert.All(
            statuses.Take(ThrottledLoginFactory.PermitLimit),
            status => Assert.Equal(HttpStatusCode.Unauthorized, status));

        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[^1]);
    }

    /// <summary>Nothing else on the API is throttled: the policy is named, not global.</summary>
    [Fact]
    public async Task OtherRoutesAreUntouched()
    {
        using var client = Factory.CreateClient();

        for (var attempt = 0; attempt <= ThrottledLoginFactory.PermitLimit * 3; attempt++)
        {
            using var response = await client.GetAsync("/api/health");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }
}

/// <summary>
/// The limiter counts every attempt, right or wrong: once the window is spent, a valid password is
/// refused too. That is the point — a throttle that let the correct password through would be a
/// free oracle, telling an attacker exactly when they guessed right.
/// </summary>
public class LoginRateLimitValidCredentialsTests(ThrottledLoginFactory factory)
    : LoginRateLimitSuite(factory), IClassFixture<ThrottledLoginFactory>
{
    [Fact]
    public async Task TheCeilingAppliesToValidCredentialsToo()
    {
        using var client = Factory.CreateClient();

        for (var attempt = 0; attempt < ThrottledLoginFactory.PermitLimit; attempt++)
        {
            using var burnt = await AttemptAsync(client, "not-the-password");
            Assert.Equal(HttpStatusCode.Unauthorized, burnt.StatusCode);
        }

        using var response = await AttemptAsync(client, AdvisorApplicationFactory.AdminPassword);
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }
}
