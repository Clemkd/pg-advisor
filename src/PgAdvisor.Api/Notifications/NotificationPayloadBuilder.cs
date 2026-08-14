using System.Text.Json;
using PgAdvisor.Api.Data;

namespace PgAdvisor.Api.Notifications;

/// <summary>
/// Construit la charge à envoyer selon la destination. Discord et Slack rejettent un JSON
/// arbitraire : ils attendent leurs propres champs. Le format « generic » reste la charge
/// complète, destinée à un webhook maison ou à un routeur d'alertes.
/// </summary>
public static class NotificationPayloadBuilder
{
    // Discord : couleurs d'embed en entier décimal.
    private const int ColorCritical = 0xDC2626;
    private const int ColorWarning = 0xD97706;
    private const int ColorInfo = 0x0284C7;
    private const int ColorResolved = 0x059669;

    // Limites imposées par l'API Discord.
    private const int DiscordTitleMax = 256;
    private const int DiscordDescriptionMax = 4096;
    private const int DiscordFieldValueMax = 1024;

    public static object Build(
        string format,
        NotificationConfiguration configuration,
        Finding finding,
        PostgresConnection instance,
        string @event) => format.ToLowerInvariant() switch
        {
            NotificationFormats.Discord => BuildDiscord(finding, instance, @event),
            NotificationFormats.Slack => BuildSlack(finding, instance, @event),
            _ => BuildGeneric(configuration, finding, instance, @event),
        };

    /// <summary>Charge de test, dans la forme attendue par la destination.</summary>
    public static object BuildTest(string format, NotificationConfiguration configuration) =>
        format.ToLowerInvariant() switch
        {
            NotificationFormats.Discord => new
            {
                username = "PostgreSQL Advisor",
                content = $"Test delivery from PostgreSQL Advisor (webhook \"{configuration.Key}\").",
            },
            NotificationFormats.Slack => new
            {
                text = $"Test delivery from PostgreSQL Advisor (webhook \"{configuration.Key}\").",
            },
            _ => new
            {
                webhook = configuration.Key,
                @event = "test",
                at = DateTimeOffset.UtcNow,
                message = "Test delivery from PostgreSQL Advisor.",
            },
        };

    private static object BuildGeneric(
        NotificationConfiguration configuration,
        Finding finding,
        PostgresConnection instance,
        string @event) => new
        {
            webhook = configuration.Key,
            @event,
            at = DateTimeOffset.UtcNow,
            instance = new
            {
                id = instance.Id,
                name = instance.Name,
                host = instance.Host,
                port = instance.Port,
                database = instance.Database,
                serverVersion = instance.ServerVersion,
            },
            finding = new
            {
                id = finding.Id,
                ruleId = finding.RuleId,
                ruleVersion = finding.RuleVersion,
                target = finding.TargetKey,
                category = finding.Category,
                severity = finding.Severity,
                title = finding.Title,
                message = finding.Message,
                impact = finding.Impact,
                confidence = finding.Confidence,
                status = finding.Status,
                detectedAt = finding.DetectedAt,
                resolvedAt = finding.ResolvedAt,
                occurrences = finding.OccurrenceCount,
                documentation = finding.Documentation,
                remediationSql = finding.RemediationSql,
                evidence = ParseEvidence(finding.EvidenceJson),
            },
        };

    private static object BuildDiscord(Finding finding, PostgresConnection instance, string @event)
    {
        var resolved = @event == NotificationEvents.FindingResolved;

        var fields = new List<object>
        {
            new { name = "Instance", value = Truncate(instance.Name, DiscordFieldValueMax), inline = true },
            new { name = "Category", value = finding.Category, inline = true },
            new { name = "Severity", value = finding.Severity, inline = true },
        };

        if (!string.IsNullOrWhiteSpace(finding.TargetKey))
        {
            fields.Add(new { name = "Target", value = Truncate(finding.TargetKey, DiscordFieldValueMax), inline = false });
        }

        fields.Add(new { name = "Rule", value = Truncate(finding.RuleId, DiscordFieldValueMax), inline = true });

        if (!string.IsNullOrWhiteSpace(finding.Impact))
        {
            fields.Add(new { name = "Impact", value = finding.Impact, inline = true });
        }

        if (!resolved && !string.IsNullOrWhiteSpace(finding.RemediationSql))
        {
            // Bloc de code Discord : les backticks encadrent le SQL correctif.
            var sql = Truncate(finding.RemediationSql, DiscordFieldValueMax - 12);
            fields.Add(new { name = "Suggested fix", value = $"```sql\n{sql}\n```", inline = false });
        }

        var prefix = resolved ? "Resolved" : Prefix(finding.Severity);

        return new
        {
            username = "PostgreSQL Advisor",
            embeds = new[]
            {
                new
                {
                    title = Truncate($"{prefix} · {finding.Title}", DiscordTitleMax),
                    description = Truncate(finding.Message, DiscordDescriptionMax),
                    color = resolved ? ColorResolved : Color(finding.Severity),
                    url = string.IsNullOrWhiteSpace(finding.Documentation) ? null : finding.Documentation,
                    timestamp = DateTimeOffset.UtcNow.ToString("o"),
                    footer = new { text = $"{instance.Host}:{instance.Port}/{instance.Database}" },
                    fields = fields.ToArray(),
                },
            },
        };
    }

    private static object BuildSlack(Finding finding, PostgresConnection instance, string @event)
    {
        var resolved = @event == NotificationEvents.FindingResolved;
        var prefix = resolved ? "Resolved" : Prefix(finding.Severity);

        var fields = new List<object>
        {
            new { title = "Instance", value = instance.Name, @short = true },
            new { title = "Category", value = finding.Category, @short = true },
            new { title = "Rule", value = finding.RuleId, @short = true },
            new { title = "Severity", value = finding.Severity, @short = true },
        };

        if (!string.IsNullOrWhiteSpace(finding.TargetKey))
        {
            fields.Add(new { title = "Target", value = finding.TargetKey, @short = false });
        }

        if (!resolved && !string.IsNullOrWhiteSpace(finding.RemediationSql))
        {
            fields.Add(new { title = "Suggested fix", value = $"```{finding.RemediationSql}```", @short = false });
        }

        return new
        {
            text = $"{prefix} · {finding.Title}",
            attachments = new[]
            {
                new
                {
                    color = resolved ? "#059669" : HexColor(finding.Severity),
                    title = finding.Title,
                    title_link = string.IsNullOrWhiteSpace(finding.Documentation) ? null : finding.Documentation,
                    text = finding.Message,
                    footer = $"{instance.Host}:{instance.Port}/{instance.Database}",
                    ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    fields = fields.ToArray(),
                },
            },
        };
    }

    private static string Prefix(string severity) => severity switch
    {
        Severities.Critical => "Critical",
        Severities.Warning => "Warning",
        _ => "Info",
    };

    private static int Color(string severity) => severity switch
    {
        Severities.Critical => ColorCritical,
        Severities.Warning => ColorWarning,
        _ => ColorInfo,
    };

    private static string HexColor(string severity) => severity switch
    {
        Severities.Critical => "#dc2626",
        Severities.Warning => "#d97706",
        _ => "#0284c7",
    };

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..(max - 1)] + "…";

    private static JsonElement? ParseEvidence(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
