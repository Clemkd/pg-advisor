using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PgAdvisor.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRuleSample : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RuleSamples",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConnectionId = table.Column<int>(type: "INTEGER", nullable: false),
                    RuleId = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
                    TargetKey = table.Column<string>(type: "TEXT", maxLength: 512, nullable: false),
                    ValuesJson = table.Column<string>(type: "TEXT", nullable: false),
                    At = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RuleSamples", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RuleSamples_PostgresConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalTable: "PostgresConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RuleSamples_ConnectionId_RuleId_TargetKey",
                table: "RuleSamples",
                columns: new[] { "ConnectionId", "RuleId", "TargetKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RuleSamples");
        }
    }
}
