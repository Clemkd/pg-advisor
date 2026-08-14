using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PgAdvisor.Api.Security;

namespace PgAdvisor.Api.Data;

/// <summary>
/// Applique les migrations au démarrage et crée le compte administrateur initial.
/// Le mot de passe de bootstrap est journalisé une seule fois, à la création.
/// </summary>
public sealed class DatabaseInitializer(
    IServiceScopeFactory scopeFactory,
    IOptions<AdvisorOptions> options,
    ILogger<DatabaseInitializer> logger) : IHostedService
{
    private readonly AdvisorOptions _options = options.Value;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_options.DataDirectory);
        Directory.CreateDirectory(_options.UserRulesDirectory);

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AdvisorDbContext>();

        await db.Database.MigrateAsync(cancellationToken);
        await EnsureAdminAsync(db, cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task EnsureAdminAsync(AdvisorDbContext db, CancellationToken cancellationToken)
    {
        if (await db.Users.AnyAsync(cancellationToken))
        {
            return;
        }

        var username = string.IsNullOrWhiteSpace(_options.Auth.BootstrapUsername)
            ? "admin"
            : _options.Auth.BootstrapUsername.Trim();

        var provided = !string.IsNullOrWhiteSpace(_options.Auth.BootstrapPassword);
        var password = provided
            ? _options.Auth.BootstrapPassword!
            : PasswordHasher.GenerateReadablePassword();

        db.Users.Add(new User
        {
            Username = username,
            PasswordHash = PasswordHasher.Hash(password),
            Role = Roles.Admin,
            CreatedAt = DateTimeOffset.UtcNow,
            MustChangePassword = !provided,
        });

        await db.SaveChangesAsync(cancellationToken);

        if (provided)
        {
            logger.LogInformation(
                "Administrator account {Username} created with the password supplied by the configuration.",
                username);
        }
        else
        {
            logger.LogWarning(
                "Administrator account created. Username: {Username} - password: {Password}\n" +
                "This password is shown only once; change it after the first sign-in.",
                username, password);
        }
    }
}
