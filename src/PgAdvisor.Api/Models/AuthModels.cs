using System.ComponentModel.DataAnnotations;

namespace PgAdvisor.Api.Models;

public sealed record LoginRequest
{
    [Required, MaxLength(128)]
    public string Username { get; init; } = string.Empty;

    [Required]
    public string Password { get; init; } = string.Empty;
}

public sealed record ChangePasswordRequest
{
    [Required]
    public string CurrentPassword { get; init; } = string.Empty;

    [Required, MinLength(10), MaxLength(256)]
    public string NewPassword { get; init; } = string.Empty;
}

public sealed record CurrentUserResponse(
    int Id,
    string Username,
    string Role,
    bool MustChangePassword);

public sealed record UserResponse(
    int Id,
    string Username,
    string Role,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAt,
    bool MustChangePassword);

public sealed record CreateUserRequest
{
    [Required, MaxLength(128), RegularExpression(@"^[A-Za-z0-9._@-]+$")]
    public string Username { get; init; } = string.Empty;

    [Required, MinLength(10), MaxLength(256)]
    public string Password { get; init; } = string.Empty;

    [Required]
    public string Role { get; init; } = "Viewer";
}

public sealed record UpdateUserRequest
{
    public string? Role { get; init; }

    [MinLength(10), MaxLength(256)]
    public string? Password { get; init; }
}
