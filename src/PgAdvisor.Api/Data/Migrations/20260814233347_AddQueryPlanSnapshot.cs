using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PgAdvisor.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddQueryPlanSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "QueryPlanSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ConnectionId = table.Column<int>(type: "INTEGER", nullable: false),
                    QueryKey = table.Column<string>(type: "TEXT", maxLength: 128, nullable: false),
                    QueryId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: true),
                    Sql = table.Column<string>(type: "TEXT", nullable: false),
                    ParametersJson = table.Column<string>(type: "TEXT", nullable: true),
                    PlanJson = table.Column<string>(type: "TEXT", nullable: false),
                    PlanText = table.Column<string>(type: "TEXT", nullable: false),
                    MeasuredAt = table.Column<long>(type: "INTEGER", nullable: false),
                    DurationMs = table.Column<double>(type: "REAL", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QueryPlanSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_QueryPlanSnapshots_PostgresConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalTable: "PostgresConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_QueryPlanSnapshots_ConnectionId_QueryKey",
                table: "QueryPlanSnapshots",
                columns: new[] { "ConnectionId", "QueryKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "QueryPlanSnapshots");
        }
    }
}
