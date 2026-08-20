using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using PgAdvisor.Api;
using PgAdvisor.Api.Collectors;
using PgAdvisor.Api.Data;
using PgAdvisor.Api.Findings;
using PgAdvisor.Api.Notifications;
using PgAdvisor.Api.Postgres;
using PgAdvisor.Api.Rules;
using PgAdvisor.Api.Rules.Handlers;
using PgAdvisor.Api.Scheduler;
using PgAdvisor.Api.Security;
using PgAdvisor.Api.Services;
using PgAdvisor.Api.Sse;
using PgAdvisor.Api.State;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddEnvironmentVariables("PGADVISOR_");

var advisorOptions = builder.Configuration.Get<AdvisorOptions>() ?? new AdvisorOptions();
builder.Services.Configure<AdvisorOptions>(builder.Configuration);

Directory.CreateDirectory(advisorOptions.DataDirectory);

builder.Services.AddDbContext<AdvisorDbContext>(o =>
    o.UseSqlite($"Data Source={advisorOptions.DatabasePath}"));

// Les clés de protection des données vivent dans le volume : sans cela, un redémarrage du
// conteneur invaliderait tous les cookies d'authentification.
builder.Services
    .AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(advisorOptions.DataDirectory, "keys")))
    .SetApplicationName("pg-advisor");

builder.Services.AddSingleton<SecretProtector>();
builder.Services.AddSingleton<InstanceStateStore>();
builder.Services.AddSingleton<PgConnectionFactory>();
builder.Services.AddSingleton<CapabilityDetector>();
builder.Services.AddSingleton<InstanceCollector>();
builder.Services.AddSingleton<QueryAnalysisService>();
builder.Services.AddSingleton<QueryParameterSuggester>();
builder.Services.AddSingleton<ConnectionPresenter>();

// Rule engine : les handlers sont découverts par injection, un ajout ne touche pas au reste.
builder.Services.AddSingleton<IRuleHandler, MissingExtensionHandler>();
builder.Services.AddSingleton<IRuleHandler, RedundantIndexHandler>();
builder.Services.AddSingleton<RuleHandlerRegistry>();
builder.Services.AddSingleton<RuleLoader>();
builder.Services.AddSingleton<RuleStore>();
builder.Services.AddSingleton<RuleEngine>();
builder.Services.AddSingleton<RuleWatcher>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<RuleWatcher>());
builder.Services.AddSingleton<RuleFileService>();

// Findings et score.
builder.Services.AddSingleton<HealthScoreCalculator>();
builder.Services.AddSingleton<InstanceHealthService>();
builder.Services.AddScoped<FindingService>();

// Temps réel et notifications.
builder.Services.AddSingleton<EventBus>();
builder.Services.AddSingleton<NotificationQueue>();
builder.Services.AddHostedService<NotificationDispatcher>();
builder.Services.AddHttpClient("webhook", client =>
{
    client.Timeout = advisorOptions.Notifications.Timeout;
    client.DefaultRequestHeaders.UserAgent.ParseAdd("pg-advisor/1.0");
});

// Collecte périodique.
builder.Services.AddSingleton<RuleGuard>();
builder.Services.AddSingleton<AnalysisService>();
builder.Services.AddHostedService<SchedulerService>();

builder.Services.AddHostedService<DatabaseInitializer>();

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = advisorOptions.Auth.CookieName;
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        // Secure dès que la requête est en HTTPS ; forcé si RequireHttps est activé.
        options.Cookie.SecurePolicy = advisorOptions.Auth.RequireHttps
            ? CookieSecurePolicy.Always
            : CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(Math.Max(1, advisorOptions.Auth.SlidingExpirationHours));

        // API : renvoyer des codes plutôt que rediriger vers une page de login.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

// Toute l'API est protégée par défaut ; les exceptions sont explicites via [AllowAnonymous].
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseExceptionHandler();
app.UseStatusCodePages();

// Le SPA compilé est servi depuis wwwroot ; les routes inconnues retombent sur index.html
// pour laisser le routeur client les traiter.
app.UseDefaultFiles();
app.UseStaticFiles();

// Routage déclaré explicitement APRÈS les fichiers statiques : le middleware de fichiers
// statiques s'abstient lorsqu'un endpoint est déjà associé à la requête, et le fallback SPA
// attrape-tout ci-dessous en associerait un à chaque requête — y compris aux assets.
app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

// Une route d'API inconnue doit répondre en JSON, jamais servir le SPA : sans ce garde-fou,
// le fallback ci-dessous renverrait index.html à un client d'API.
app.Map("/api/{**path}", () => Results.NotFound()).AllowAnonymous();

// Fallback SPA sur toutes les routes, y compris celles contenant un point : les identifiants
// de règles en comportent (vacuum.dead-tuples), et la contrainte « nonfile » par défaut les
// prendrait pour des fichiers.
app.MapFallbackToFile("{*path}", "index.html").AllowAnonymous();

app.Run();

// Top-level statements compile into an internal Program class, which WebApplicationFactory
// cannot reach: this declaration opens it to the integration tests without changing behaviour.
public partial class Program;
