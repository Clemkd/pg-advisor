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
            // Support de la déduplication : un événement notifié une seule fois par cycle de finding.
            e.HasIndex(h => new { h.ConfigurationId, h.FindingId, h.Event, h.Cycle }).IsUnique();
            e.Property(h => h.Event).HasMaxLength(32).IsRequired();

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

        b.Entity<Setting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(128);
        });
    }
}
