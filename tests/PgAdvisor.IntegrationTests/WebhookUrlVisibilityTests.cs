using System.Net.Http.Json;

namespace PgAdvisor.IntegrationTests;

/// <summary>
/// A Slack or Discord webhook URL carries its token in the path: whoever reads it can post as the
/// Advisor. The list endpoint is open to any signed-in account, so the URL has to be masked there.
/// </summary>
public class WebhookUrlVisibilityTests(DefaultApplicationFactory factory)
    : IClassFixture<DefaultApplicationFactory>
{
    private const string Secret = "T00000000/B00000000/xxxxxxxxxxxxxxxxxxxxxxxx";
    private static readonly string Url = $"https://hooks.slack.com/services/{Secret}";

    private async Task EnsureWebhookExistsAsync(HttpClient admin)
    {
        using var response = await admin.PostAsJsonAsync("/api/notifications", new
        {
            key = "visibility-probe",
            url = Url,
            format = "slack",
            minimumSeverity = "info",
            events = new[] { "new_finding" },
            enabled = true,
        });

        // A rerun against the same fixture finds the key already taken, which is just as good.
        Assert.True(
            response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.Conflict,
            $"Unexpected status while seeding the webhook: {response.StatusCode}");
    }

    [Fact]
    public async Task AViewerNeverSeesTheSecretPart()
    {
        using var admin = await factory.SignInAsAdminAsync();
        await EnsureWebhookExistsAsync(admin);

        using var viewer = await factory.SignInAsViewerAsync();
        var body = await viewer.GetStringAsync("/api/notifications");

        Assert.DoesNotContain(Secret, body, StringComparison.Ordinal);
        Assert.DoesNotContain(Url, body, StringComparison.Ordinal);

        // The origin survives: the interface still tells Slack from Discord and flags a mismatch.
        Assert.Contains("hooks.slack.com", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AnAdminStillReadsTheWholeUrl()
    {
        using var admin = await factory.SignInAsAdminAsync();
        await EnsureWebhookExistsAsync(admin);

        var body = await admin.GetStringAsync("/api/notifications");

        Assert.Contains(Secret, body, StringComparison.Ordinal);
    }
}
