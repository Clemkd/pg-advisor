using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace PgAdvisor.Api.Data;

/// <summary>
/// SQLite stocke les DateTimeOffset sous forme de texte avec décalage, non triable, et refuse
/// donc l'ORDER BY dessus. Les ticks UTC sont triables et comparables, et la conversion reste
/// invisible pour le reste du code.
/// </summary>
public sealed class DateTimeOffsetToTicksConverter()
    : ValueConverter<DateTimeOffset, long>(
        value => value.ToUniversalTime().Ticks,
        ticks => new DateTimeOffset(ticks, TimeSpan.Zero));

public class AdvisorDbContext(DbContextOptions<AdvisorDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<PostgresConnection> PostgresConnections => Set<PostgresConnection>();
    public DbSet<Finding> Findings => Set<Finding>();
    public DbSet<FindingHistoryEntry> FindingHistory => Set<FindingHistoryEntry>();
    public DbSet<NotificationConfiguration> NotificationConfigurations => Set<NotificationConfiguration>();
    public DbSet<NotificationHistoryEntry> NotificationHistory => Set<NotificationHistoryEntry>();
    public DbSet<RuleOverride> RuleOverrides => Set<RuleOverride>();
    public DbSet<RuleHealth> RuleHealth => Set<RuleHealth>();
    public DbSet<RuleSample> RuleSamples => Set<RuleSample>();
    public DbSet<QueryPlanSnapshot> QueryPlanSnapshots => Set<QueryPlanSnapshot>();
    public DbSet<Setting> Settings => Set<Setting>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // S'applique aussi aux propriétés nullables : tous les horodatages deviennent triables.
        builder.Properties<DateTimeOffset>().HaveConversion<DateTimeOffsetToTicksConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(u => u.Username).IsUnique();
            e.Property(u => u.Username).HasMaxLength(128).IsRequired();
            e.Property(u => u.PasswordHash).IsRequired();
            e.Property(u => u.Role).HasMaxLength(32).IsRequired();
        });

        b.Entity<PostgresConnection>(e =>
        {
            e.HasIndex(c => c.Name).IsUnique();
            e.Property(c => c.Name).HasMaxLength(128).IsRequired();
            e.Property(c => c.Host).HasMaxLength(255).IsRequired();
            e.Property(c => c.Database).HasMaxLength(128).IsRequired();
            e.Property(c => c.Username).HasMaxLength(128).IsRequired();
            e.Property(c => c.SslMode).HasMaxLength(32);
        });

        b.Entity<Finding>(e =>
        {
            // Identité fonctionnelle d'un finding : une règle, une cible, une instance.
            e.HasIndex(f => new { f.ConnectionId, f.RuleId, f.TargetKey }).IsUnique();
            e.HasIndex(f => new { f.ConnectionId, f.Status });

            // La vue par défaut ne filtre pas sur l'instance : « tous les diagnostics actifs, du
            // plus récent au plus ancien ». Sans cet index, cette page-là balayait toute la table.
            // Le tri par sévérité, lui, porte sur des expressions et reste en mémoire — le rendre
            // indexable demanderait une colonne de rang, ce qui n'en vaut la peine que le jour où
            // le volume le justifie.
            e.HasIndex(f => new { f.Status, f.LastSeenAt });
            e.Property(f => f.RuleId).HasMaxLength(128).IsRequired();
            e.Property(f => f.TargetKey).HasMaxLength(512).IsRequired();
            e.Property(f => f.Category).HasMaxLength(64).IsRequired();
            e.Property(f => f.Severity).HasMaxLength(16).IsRequired();
            e.Property(f => f.Status).HasMaxLength(16).IsRequired();

            e.HasOne(f => f.Connection)
                .WithMany(c => c.Findings)
                .HasForeignKey(f => f.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<FindingHistoryEntry>(e =>
        {
            e.HasIndex(h => new { h.FindingId, h.At });
            e.Property(h => h.ToStatus).HasMaxLength(16).IsRequired();

            e.HasOne(h => h.Finding)
                .WithMany(f => f.History)
                .HasForeignKey(h => h.FindingId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<NotificationConfiguration>(e =>
        {
            e.HasIndex(n => n.Key).IsUnique();
            e.Property(n => n.Key).HasMaxLength(64).IsRequired();
            e.Property(n => n.Url).IsRequired();
            e.Property(n => n.MinimumSeverity).HasMaxLength(16).IsRequired();
            e.Property(n => n.Format).HasMaxLength(16).IsRequired().HasDefaultValue(NotificationFormats.Generic);

            e.HasOne<PostgresConnection>()
                .WithMany()
                .HasForeignKey(n => n.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<NotificationHistoryEntry>(e =>
        {
            // Support de la déduplication : un événement notifié une seule fois par cycle et par
            // sujet. Le sujet fait partie de la clé : un finding et une règle peuvent porter le
            // même identifiant numérique sans se confondre.
            e.HasIndex(h => new { h.ConfigurationId, h.Subject, h.SubjectId, h.Event, h.Cycle }).IsUnique();
            e.Property(h => h.Event).HasMaxLength(32).IsRequired();
            e.Property(h => h.Subject).HasMaxLength(16).IsRequired().HasDefaultValue(NotificationSubjects.Finding);

            e.HasOne(h => h.Configuration)
                .WithMany()
                .HasForeignKey(h => h.ConfigurationId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RuleOverride>(e =>
        {
            e.HasIndex(r => new { r.RuleId, r.ConnectionId }).IsUnique();
            e.Property(r => r.RuleId).HasMaxLength(128).IsRequired();
            e.Property(r => r.Severity).HasMaxLength(16);

            e.HasOne(r => r.Connection)
                .WithMany()
                .HasForeignKey(r => r.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RuleSample>(e =>
        {
            e.HasIndex(s => new { s.ConnectionId, s.RuleId, s.TargetKey }).IsUnique();
            e.Property(s => s.RuleId).HasMaxLength(128).IsRequired();
            e.Property(s => s.TargetKey).HasMaxLength(512).IsRequired();

            e.HasOne(s => s.Connection)
                .WithMany()
                .HasForeignKey(s => s.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RuleHealth>(e =>
        {
            // Une règle, une instance : le garde-fou ne raisonne jamais autrement.
            e.HasIndex(h => new { h.ConnectionId, h.RuleId }).IsUnique();
            e.HasIndex(h => h.State);
            e.Property(h => h.RuleId).HasMaxLength(128).IsRequired();
            e.Property(h => h.State).HasMaxLength(16).IsRequired();
            e.Property(h => h.LastFailureKind).HasMaxLength(16);
            e.Property(h => h.LastFailureMessage).HasMaxLength(500);
            e.Property(h => h.QuarantineReason).HasMaxLength(500);

            // Compteur dérivé : il se recalcule, il ne se stocke pas.
            e.Ignore(h => h.Strikes);

            e.HasOne(h => h.Connection)
                .WithMany()
                .HasForeignKey(h => h.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<QueryPlanSnapshot>(e =>
        {
            // Une requête, une instance, un plan : la mesure la plus récente écrase la précédente.
            e.HasIndex(s => new { s.ConnectionId, s.QueryKey }).IsUnique();
            e.Property(s => s.QueryKey).HasMaxLength(128).IsRequired();
            e.Property(s => s.QueryId).HasMaxLength(64);
            e.Property(s => s.Sql).IsRequired();
            e.Property(s => s.PlanJson).IsRequired();

            e.HasOne(s => s.Connection)
                .WithMany()
                .HasForeignKey(s => s.ConnectionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Setting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(128);
        });
    }
}
