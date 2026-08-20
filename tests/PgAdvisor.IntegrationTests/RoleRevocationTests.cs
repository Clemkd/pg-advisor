using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Security;

namespace PgAdvisor.IntegrationTests;

/// <summary>
/// The role travels in the session cookie. Without a check on each request, demoting or deleting
/// an account would leave its privileges standing until the cookie expired — twelve sliding hours.
/// </summary>
public class RoleRevocationTests(AdvisorApplicationFactory factory)
    : IClassFixture<AdvisorApplicationFactory>
{
    private const string Password = "revocation-probe-password";

    private async Task<HttpClient> SignInAsFreshAdminAsync(string username)
    {
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();

            var existing = await db.Users.SingleOrDefaultAsync(user => user.Username == username);

            if (existing is null)
            {
                db.Users.Add(new User
                {
                    Username = username,
                    PasswordHash = PasswordHasher.Hash(Password),
                    Role = Roles.Admin,
                    CreatedAt = DateTimeOffset.UtcNow,
                });
            }
            else
            {
                // "Fresh" has to mean it: a previous case may have left this account demoted.
                existing.PasswordHash = PasswordHasher.Hash(Password);
                existing.Role = Roles.Admin;
            }

            await db.SaveChangesAsync();
        }

        return await factory.SignInAsync(username, Password);
    }

    private async Task ChangeRoleAsync(string username, string role)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();
        var user = await db.Users.SingleAsync(candidate => candidate.Username == username);
        user.Role = role;
        await db.SaveChangesAsync();
    }

    private async Task DeleteAsync(string username)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();
        var user = await db.Users.SingleAsync(candidate => candidate.Username == username);
        db.Users.Remove(user);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task DemotingAnAdminTakesEffectOnTheNextRequest()
    {
        using var client = await SignInAsFreshAdminAsync("demoted-admin");

        using (var before = await client.GetAsync("/api/auth/users"))
        {
            Assert.Equal(HttpStatusCode.OK, before.StatusCode);
        }

        await ChangeRoleAsync("demoted-admin", Roles.Viewer);

        // Same cookie, same client: only the stored role changed.
        using var after = await client.GetAsync("/api/auth/users");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task DeletingAnAccountEndsItsSession()
    {
        using var client = await SignInAsFreshAdminAsync("deleted-admin");

        using (var before = await client.GetAsync("/api/auth/me"))
        {
            Assert.Equal(HttpStatusCode.OK, before.StatusCode);
        }

        await DeleteAsync("deleted-admin");

        using var after = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task AnUntouchedSessionKeepsWorking()
    {
        using var client = await SignInAsFreshAdminAsync("untouched-admin");

        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var response = await client.GetAsync("/api/auth/users");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }
}
