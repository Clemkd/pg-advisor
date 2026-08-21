using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PgAdvisor.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFindingStatusLastSeenIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Findings_Status_LastSeenAt",
                table: "Findings",
                columns: new[] { "Status", "LastSeenAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Findings_Status_LastSeenAt",
                table: "Findings");
        }
    }
}
