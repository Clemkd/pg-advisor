using System.Text.Json;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Notifications;

namespace PgAdvisor.Tests;

/// <summary>
/// Discord et Slack refusent un JSON quelconque : Discord répond « 400 Bad Request » si la
/// charge ne contient ni « content » ni « embeds ». Ces tests verrouillent la forme envoyée.
/// </summary>
public class NotificationPayloadTests
{
    private static readonly PostgresConnection Instance = new()
    {
        Id = 1,
        Name = "Production",
        Host = "db.exemple.local",
        Port = 5432,
        Database = "shop",
        ServerVersion = "17.10",
    };

    private static Finding Finding(string severity = Severities.Critical) => new()
    {
        Id = 42,
        ConnectionId = 1,
        Connection = Instance,
        RuleId = "vacuum.dead-tuples",
        RuleVersion = 1,
        TargetKey = "public/commandes",
        Category = "vacuum",
        Severity = severity,
        Title = "Autovacuum en retard sur public.commandes",
        Message = "commandes présente 55.5 % de lignes mortes.",
        Impact = "medium",
        Confidence = "high",
        RemediationSql = "VACUUM (ANALYZE) public.commandes;",
        Documentation = "https://www.postgresql.org/docs/current/routine-vacuuming.html",
        EvidenceJson = """{"n_dead_tup":28551,"ratio":0.555}""",
        DetectedAt = DateTimeOffset.UnixEpoch,
        LastSeenAt = DateTimeOffset.UnixEpoch,
    };

    private static NotificationConfiguration Configuration(string format) => new()
    {
        Id = 1,
        Key = "operations",
        Url = "https://exemple.local/hook",
        Format = format,
        MinimumSeverity = Severities.Info,
    };

    private static JsonElement Serialize(object payload) =>
        JsonSerializer.SerializeToElement(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    // --- Discord ------------------------------------------------------------

    [Fact]
    public void DiscordFournitUnEmbed()
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Discord, Configuration("discord"), Finding(), Instance,
            NotificationEvents.NewFinding));

        // Discord exige au moins l'un des deux : sinon « Cannot send an empty message ».
        Assert.True(json.TryGetProperty("embeds", out var embeds) || json.TryGetProperty("content", out _));

        var embed = embeds.EnumerateArray().Single();
        Assert.Contains("Autovacuum", embed.GetProperty("title").GetString());
        Assert.Contains("lignes mortes", embed.GetProperty("description").GetString());
        Assert.Equal(0xDC2626, embed.GetProperty("color").GetInt32());
        Assert.NotEmpty(embed.GetProperty("fields").EnumerateArray());
    }

    [Fact]
    public void DiscordPorteLesChampsAttendus()
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Discord, Configuration("discord"), Finding(), Instance,
            NotificationEvents.NewFinding));

        var fields = json.GetProperty("embeds").EnumerateArray().Single()
            .GetProperty("fields").EnumerateArray()
            .ToDictionary(f => f.GetProperty("name").GetString()!, f => f.GetProperty("value").GetString()!);

        Assert.Equal("Production", fields["Instance"]);
        Assert.Equal("vacuum", fields["Catégorie"]);
        Assert.Equal("public/commandes", fields["Objet"]);
        Assert.Equal("vacuum.dead-tuples", fields["Règle"]);
        Assert.Contains("VACUUM (ANALYZE)", fields["Correctif proposé"]);
    }

    [Fact]
    public void DiscordUtiliseLaCouleurDeResolutionEtOmetLeCorrectif()
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Discord, Configuration("discord"), Finding(), Instance,
            NotificationEvents.FindingResolved));

        var embed = json.GetProperty("embeds").EnumerateArray().Single();
        Assert.Equal(0x059669, embed.GetProperty("color").GetInt32());
        Assert.StartsWith("Résolu", embed.GetProperty("title").GetString());

        var names = embed.GetProperty("fields").EnumerateArray()
            .Select(f => f.GetProperty("name").GetString())
            .ToList();

        // Proposer un correctif pour un problème déjà résolu n'aurait pas de sens.
        Assert.DoesNotContain("Correctif proposé", names);
    }

    [Theory]
    [InlineData(Severities.Critical, 0xDC2626)]
    [InlineData(Severities.Warning, 0xD97706)]
    [InlineData(Severities.Info, 0x0284C7)]
    public void DiscordColoreSelonLaSeverite(string severity, int expected)
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Discord, Configuration("discord"), Finding(severity), Instance,
            NotificationEvents.NewFinding));

        Assert.Equal(expected,
            json.GetProperty("embeds").EnumerateArray().Single().GetProperty("color").GetInt32());
    }

    [Fact]
    public void DiscordRespecteLesLimitesDeLongueur()
    {
        var finding = Finding();
        finding.Title = new string('t', 400);
        finding.Message = new string('m', 5000);

        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Discord, Configuration("discord"), finding, Instance,
            NotificationEvents.NewFinding));

        var embed = json.GetProperty("embeds").EnumerateArray().Single();
        Assert.True(embed.GetProperty("title").GetString()!.Length <= 256);
        Assert.True(embed.GetProperty("description").GetString()!.Length <= 4096);
    }

    // --- Slack --------------------------------------------------------------

    [Fact]
    public void SlackFournitUnTexteEtUnePieceJointe()
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Slack, Configuration("slack"), Finding(), Instance,
            NotificationEvents.NewFinding));

        // Slack exige « text » ou « blocks » ; sans quoi la requête est refusée.
        Assert.False(string.IsNullOrWhiteSpace(json.GetProperty("text").GetString()));

        var attachment = json.GetProperty("attachments").EnumerateArray().Single();
        Assert.Equal("#dc2626", attachment.GetProperty("color").GetString());
        Assert.Contains("lignes mortes", attachment.GetProperty("text").GetString());
        Assert.NotEmpty(attachment.GetProperty("fields").EnumerateArray());
    }

    // --- Generic ------------------------------------------------------------

    [Fact]
    public void GeneriqueConserveLaChargeComplete()
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            NotificationFormats.Generic, Configuration("generic"), Finding(), Instance,
            NotificationEvents.NewFinding));

        Assert.Equal("operations", json.GetProperty("webhook").GetString());
        Assert.Equal("new_finding", json.GetProperty("event").GetString());
        Assert.Equal("Production", json.GetProperty("instance").GetProperty("name").GetString());

        var finding = json.GetProperty("finding");
        Assert.Equal("vacuum.dead-tuples", finding.GetProperty("ruleId").GetString());
        Assert.Equal(28551, finding.GetProperty("evidence").GetProperty("n_dead_tup").GetInt32());
    }

    [Fact]
    public void FormatInconnuRetombeSurLeGenerique()
    {
        var json = Serialize(NotificationPayloadBuilder.Build(
            "format-inexistant", Configuration("generic"), Finding(), Instance,
            NotificationEvents.NewFinding));

        Assert.True(json.TryGetProperty("finding", out _));
    }

    [Fact]
    public void SecretDeConnexionAbsentDeLaCharge()
    {
        var instance = new PostgresConnection
        {
            Id = 1,
            Name = "Production",
            Host = "db.exemple.local",
            Database = "shop",
            EncryptedPassword = "secret-chiffre-a-ne-pas-diffuser",
        };

        foreach (var format in NotificationFormats.All)
        {
            var json = Serialize(NotificationPayloadBuilder.Build(
                format, Configuration(format), Finding(), instance, NotificationEvents.NewFinding));

            Assert.DoesNotContain("secret-chiffre", json.GetRawText());
            Assert.DoesNotContain("EncryptedPassword", json.GetRawText());
        }
    }

    // --- Charges de test ----------------------------------------------------

    [Theory]
    [InlineData(NotificationFormats.Discord, "content")]
    [InlineData(NotificationFormats.Slack, "text")]
    [InlineData(NotificationFormats.Generic, "message")]
    public void ChargeDeTestSuitLeFormat(string format, string expectedProperty)
    {
        var json = Serialize(NotificationPayloadBuilder.BuildTest(format, Configuration(format)));
        Assert.True(json.TryGetProperty(expectedProperty, out _));
    }
}
