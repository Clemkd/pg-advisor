using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PgAdvisor.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRuleHealthGuard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NotificationHistory_ConfigurationId_FindingId_Event_Cycle",
                table: "NotificationHistory");

            migrationBuilder.RenameColumn(
                name: "FindingId",
                table: "NotificationHistory",
                newName: "SubjectId");

            migrationBuilder.AddColumn<int>(
                name: "TimeoutSeconds",
                table: "RuleOverrides",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Subject",
                table: "NotificationHistory",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "finding");

            migrationBuilder.CreateTable(
                name: "RuleHealth",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConnectionId = table.Column<int>(type: "INTEGER", nullable: false),
                    RuleId = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
                    State = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    ConsecutiveFailures = table.Column<int>(type: "INTEGER", nullable: false),
                    ConsecutiveSlowRuns = table.Column<int>(type: "INTEGER", nullable: false),
                    LastFailureKind = table.Column<string>(type: "TEXT", maxLength: 16, nullable: true),
                    LastFailureMessage = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    LastFailureAt = table.Column<long>(type: "INTEGER", nullable: true),
                    LastSuccessAt = table.Column<long>(type: "INTEGER", nullable: true),
                    LastDurationMs = table.Column<double>(type: "REAL", nullable: true),
                    MaxDurationMs = table.Column<double>(type: "REAL", nullable: true),
                    LastTimeoutSeconds = table.Column<int>(type: "INTEGER", nullable: true),
                    IncidentsSince = table.Column<long>(type: "INTEGER", nullable: true),
                    QuarantinedAt = table.Column<long>(type: "INTEGER", nullable: true),
                    QuarantinedUntil = table.Column<long>(type: "INTEGER", nullable: true),
                    QuarantineReason = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    QuarantineCount = table.Column<int>(type: "INTEGER", nullable: false),
                    UpdatedAt = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RuleHealth", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RuleHealth_PostgresConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalTable: "PostgresConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationHistory_ConfigurationId_Subject_SubjectId_Event_Cycle",
                table: "NotificationHistory",
                columns: new[] { "ConfigurationId", "Subject", "SubjectId", "Event", "Cycle" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RuleHealth_ConnectionId_RuleId",
                table: "RuleHealth",
                columns: new[] { "ConnectionId", "RuleId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RuleHealth_State",
                table: "RuleHealth",
                column: "State");

            // Les webhooks déjà configurés sont abonnés aux deux nouveaux événements. Sans cela,
            // le garde-fou n'avertirait personne sur une installation existante : l'exploitant a
            // demandé à être prévenu de ce qui se passe sur ses instances, une règle qui cesse
            // de produire son diagnostic en fait partie. Chaque webhook garde son filtre de
            // sévérité, et l'IHM permet de se désabonner.
            foreach (var name in new[] { "rule_degraded", "rule_quarantined" })
            {
                migrationBuilder.Sql($"""
                    UPDATE NotificationConfigurations
                    SET Events = Events || ',{name}'
                    WHERE ',' || Events || ',' NOT LIKE '%,{name},%';
                    """);
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Les événements du garde-fou n'existent plus : les laisser abonnés ferait rejeter
            // toute modification ultérieure du webhook comme portant un événement inconnu.
            foreach (var name in new[] { "rule_degraded", "rule_quarantined" })
            {
                migrationBuilder.Sql($"""
                    UPDATE NotificationConfigurations
                    SET Events = REPLACE(',' || Events || ',', ',{name},', ',')
                    WHERE ',' || Events || ',' LIKE '%,{name},%';
                    """);
            }

            migrationBuilder.Sql("""
                UPDATE NotificationConfigurations SET Events = TRIM(Events, ',');
                """);

            migrationBuilder.DropTable(
                name: "RuleHealth");

            migrationBuilder.DropIndex(
                name: "IX_NotificationHistory_ConfigurationId_Subject_SubjectId_Event_Cycle",
                table: "NotificationHistory");

            migrationBuilder.DropColumn(
                name: "TimeoutSeconds",
                table: "RuleOverrides");

            migrationBuilder.DropColumn(
                name: "Subject",
                table: "NotificationHistory");

            migrationBuilder.RenameColumn(
                name: "SubjectId",
                table: "NotificationHistory",
                newName: "FindingId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationHistory_ConfigurationId_FindingId_Event_Cycle",
                table: "NotificationHistory",
                columns: new[] { "ConfigurationId", "FindingId", "Event", "Cycle" },
                unique: true);
        }
    }
}
