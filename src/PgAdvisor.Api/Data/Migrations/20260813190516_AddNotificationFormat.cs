using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PgAdvisor.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationFormat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Format",
                table: "NotificationConfigurations",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "generic");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Format",
                table: "NotificationConfigurations");
        }
    }
}
