// Stack de développement complète : l'API, le serveur Vite, les deux PostgreSQL supervisés et le
// récepteur de webhooks démarrent ensemble, sur les mêmes ports et avec le même mot de passe que
// docker-compose.test.yml — les procédures et les scripts du dépôt restent valables.
//
//   dotnet run --project src/PgAdvisor.AppHost
//
// docker-compose.test.yml reste en place : scripts/validate-e2e.ps1 valide l'image publiée, pas
// le code en cours d'édition, et a besoin des conteneurs nommés par compose.

var builder = DistributedApplication.CreateBuilder(args);

// Mot de passe des instances de test. Il est en clair volontairement : ces bases sont jetables,
// recréées à chaque démarrage, et ne contiennent que le jeu de données du dépôt. Le remplacer
// localement se fait par `dotnet user-secrets set Parameters:pg-password ...`.
var pgPassword = builder.AddParameter("pg-password", "advisor-test", secret: true);

// Ce que l'Advisor observe. pg-full porte TimescaleDB et pg_stat_statements ; les règles
// avancées ne doivent s'activer que sur celle-là.
builder.AddPostgres("pg-full", password: pgPassword, port: 55432)
    .WithImage("timescale/timescaledb", "latest-pg17")
    .WithArgs(
        "postgres",
        "-c", "shared_preload_libraries=timescaledb,pg_stat_statements",
        "-c", "pg_stat_statements.track=all")
    // Les scripts d'amorçage tournent dans POSTGRES_DB : c'est la base que l'Advisor supervise.
    // Aucun volume de données, donc l'amorçage rejoue à chaque démarrage et l'état reste connu.
    .WithEnvironment("POSTGRES_DB", "shop")
    .WithInitFiles("../../scripts/seed-test-data.sql");

// pg-bare est un PostgreSQL nu : l'Advisor doit rester utile sans aucune extension.
builder.AddPostgres("pg-bare", password: pgPassword, port: 55433)
    .WithImageTag("17-alpine")
    .WithEnvironment("POSTGRES_DB", "billing");

// Réceptacle de webhooks : renvoie la charge reçue et la journalise.
builder.AddContainer("webhook-echo", "mendhak/http-https-echo", "37")
    .WithEnvironment("HTTP_PORT", "8888")
    .WithHttpEndpoint(port: 58888, targetPort: 8888, name: "http");

// Mot de passe du compte admin : fixé en développement pour éviter d'aller le lire dans les
// journaux à chaque première exécution. Il ne sert qu'à la création initiale du compte.
var bootstrapPassword = builder.AddParameter("advisor-password", "advisor-dev", secret: true);

var api = builder.AddProject<Projects.PgAdvisor_Api>("api")
    .WithEnvironment("PGADVISOR_Auth__BootstrapPassword", bootstrapPassword);

// Le SPA est servi par Vite en développement ; le proxy de vite.config.ts vise l'API dont
// l'adresse est injectée par la référence ci-dessous.
builder.AddViteApp("web", "../pg-advisor-web")
    .WithNpm()
    // Port fixé : c'est l'adresse par laquelle on ouvre l'application, elle a vocation à être
    // écrite dans la documentation et gardée en favori.
    .WithEndpoint("http", endpoint => endpoint.Port = 5173)
    .WithReference(api)
    .WaitFor(api);

builder.Build().Run();
