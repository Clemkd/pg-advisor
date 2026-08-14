using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Models;
using PgAdvisor.Api.Security;

namespace PgAdvisor.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(AdvisorDbContext db, ILogger<AuthController> logger) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<CurrentUserResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == request.Username, ct);

        // Message identique quel que soit le motif : pas d'énumération des comptes.
        if (user is null || !PasswordHasher.Verify(request.Password, user.PasswordHash, out var needsRehash))
        {
            logger.LogWarning("Authentication failed for {Username}", request.Username);
            return Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid credentials.");
        }

        if (needsRehash)
        {
            user.PasswordHash = PasswordHasher.Hash(request.Password);
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        await SignInAsync(user);
        logger.LogInformation("{Username} signed in", user.Username);

        return Ok(new CurrentUserResponse(user.Id, user.Username, user.Role, user.MustChangePassword));
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    [HttpGet("me")]
    public async Task<ActionResult<CurrentUserResponse>> Me(CancellationToken ct)
    {
        var user = await CurrentUserAsync(ct);
        if (user is null)
        {
            // Le cookie référence un compte supprimé : on l'invalide.
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Unauthorized();
        }

        return Ok(new CurrentUserResponse(user.Id, user.Username, user.Role, user.MustChangePassword));
    }

    [HttpPost("password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await CurrentUserAsync(ct);
        if (user is null)
        {
            return Unauthorized();
        }

        if (!PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash, out _))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Current password is incorrect.");
        }

        user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
        user.MustChangePassword = false;
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Password changed for {Username}", user.Username);
        return NoContent();
    }

    [HttpGet("users")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IEnumerable<UserResponse>>> ListUsers(CancellationToken ct)
    {
        var users = await db.Users
            .OrderBy(u => u.Username)
            .Select(u => new UserResponse(u.Id, u.Username, u.Role, u.CreatedAt, u.LastLoginAt, u.MustChangePassword))
            .ToListAsync(ct);

        return Ok(users);
    }

    [HttpPost("users")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<UserResponse>> CreateUser(CreateUserRequest request, CancellationToken ct)
    {
        if (!Roles.IsValid(request.Role))
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Unknown role.");
        }

        if (await db.Users.AnyAsync(u => u.Username == request.Username, ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "This username is already taken.");
        }

        var user = new User
        {
            Username = request.Username,
            PasswordHash = PasswordHasher.Hash(request.Password),
            Role = request.Role,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(ListUsers), null,
            new UserResponse(user.Id, user.Username, user.Role, user.CreatedAt, user.LastLoginAt, user.MustChangePassword));
    }

    [HttpPatch("users/{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> UpdateUser(int id, UpdateUserRequest request, CancellationToken ct)
    {
        var user = await db.Users.FindAsync([id], ct);
        if (user is null)
        {
            return NotFound();
        }

        if (request.Role is not null)
        {
            if (!Roles.IsValid(request.Role))
            {
                return Problem(statusCode: StatusCodes.Status400BadRequest, title: "Unknown role.");
            }

            // Ne pas se retrouver sans administrateur.
            if (user.Role == Roles.Admin && request.Role != Roles.Admin &&
                await db.Users.CountAsync(u => u.Role == Roles.Admin, ct) == 1)
            {
                return Problem(statusCode: StatusCodes.Status400BadRequest,
                    title: "The last administrator cannot be demoted.");
            }

            user.Role = request.Role;
        }

        if (request.Password is not null)
        {
            user.PasswordHash = PasswordHasher.Hash(request.Password);
            user.MustChangePassword = false;
        }

        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("users/{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> DeleteUser(int id, CancellationToken ct)
    {
        var user = await db.Users.FindAsync([id], ct);
        if (user is null)
        {
            return NoContent();
        }

        if (user.Role == Roles.Admin && await db.Users.CountAsync(u => u.Role == Roles.Admin, ct) == 1)
        {
            return Problem(statusCode: StatusCodes.Status400BadRequest,
                title: "The last administrator cannot be deleted.");
        }

        db.Users.Remove(user);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private Task SignInAsync(User user)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);

        return HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true });
    }

    private async Task<User?> CurrentUserAsync(CancellationToken ct)
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(id, out var userId)
            ? await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct)
            : null;
    }
}
