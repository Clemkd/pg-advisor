using Microsoft.Extensions.Options;
using Npgsql;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Security;

namespace PgAdvisor.Api.Postgres;

/// <summary>
/// Ouvre les connexions vers les instances supervisées. Le principe zero-touch est appliqué
/// côté session : la connexion est forcée en lecture seule et bornée en durée, si bien qu'une
/// règle mal écrite ne peut ni écrire ni monopoliser le serveur supervisé.
/// </summary>
public sealed class PgConnectionFactory(
    SecretProtector protector,
    IOptions<AdvisorOptions> options,
    ILogger<PgConnectionFactory> logger)
{
    private readonly SchedulerOptions _scheduler = options.Value.Scheduler;

    public string BuildConnectionString(PostgresConnection connection, string? plainPassword = null)
    {
        var password = plainPassword ?? DecryptPassword(connection);
        var statementTimeoutMs = (int)_scheduler.QueryTimeout.TotalMilliseconds;

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = connection.Host,
            Port = connection.Port,
            Database = connection.Database,
            Username = connection.Username,
            Password = password,
            ApplicationName = "pg-advisor",
            Timeout = 10,
            CommandTimeout = (int)_scheduler.QueryTimeout.TotalSeconds,
            Pooling = true,
            MinPoolSize = 0,
            MaxPoolSize = 4,
            ConnectionIdleLifetime = 120,
            // Garde-fous appliqués à la session, pas au serveur : rien n'est modifié durablement.
            Options = string.Join(' ',
                "-c default_transaction_read_only=on",
                $"-c statement_timeout={statementTimeoutMs}",
                $"-c idle_in_transaction_session_timeout={statementTimeoutMs * 2}"),
        };

        if (Enum.TryParse<SslMode>(connection.SslMode, ignoreCase: true, out var sslMode))
        {
            builder.SslMode = sslMode;
        }
        else
        {
            builder.SslMode = SslMode.Prefer;
        }

        return builder.ConnectionString;
    }

    public async Task<NpgsqlConnection> OpenAsync(
        PostgresConnection connection,
        CancellationToken cancellationToken,
        string? plainPassword = null)
    {
        var npgsql = new NpgsqlConnection(BuildConnectionString(connection, plainPassword));
        try
        {
            await npgsql.OpenAsync(cancellationToken);
            return npgsql;
        }
        catch
        {
            await npgsql.DisposeAsync();
            throw;
        }
    }

    private string DecryptPassword(PostgresConnection connection)
    {
        try
        {
            return protector.Unprotect(connection.EncryptedPassword);
        }
        catch (Exception ex)
        {
            // Ne jamais journaliser le contenu chiffré : seul l'identifiant de connexion est tracé.
            logger.LogError(ex,
                "Cannot decrypt the secret of connection {ConnectionId}; the password must be entered again.",
                connection.Id);
            throw new InvalidOperationException(
                "The stored secret is unreadable (encryption key changed?). Enter the password again.");
        }
    }
}
