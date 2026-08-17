# syntax=docker/dockerfile:1

# --- SPA ---------------------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /src
COPY src/pg-advisor-web/package*.json ./
RUN npm ci
COPY src/pg-advisor-web/ ./
RUN npm run build -- --outDir /out --emptyOutDir

# --- API ---------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
# Restauration à partir du seul csproj de l'API : la couche est réutilisée tant que les
# dépendances ne changent pas, et le fichier solution n'a pas à être copié.
COPY src/PgAdvisor.Api/PgAdvisor.Api.csproj src/PgAdvisor.Api/
RUN dotnet restore src/PgAdvisor.Api/PgAdvisor.Api.csproj
COPY src/PgAdvisor.Api/ src/PgAdvisor.Api/
RUN dotnet publish src/PgAdvisor.Api/PgAdvisor.Api.csproj -c Release -o /app --no-restore

# --- Runtime -----------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

# Npgsql charge GSSAPI au démarrage pour l'authentification Kerberos ; sans cette
# bibliothèque, l'image journalise une erreur de chargement à chaque lancement.
# curl sert au HEALTHCHECK ci-dessous, absent de l'image aspnet de base.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=api /app ./
COPY --from=web /out ./wwwroot
COPY rules/ /app/rules/

ENV ASPNETCORE_HTTP_PORTS=8080 \
    PGADVISOR_DataDirectory=/app/data \
    PGADVISOR_RulesDirectory=/app/rules

EXPOSE 8080
VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

ENTRYPOINT ["dotnet", "PgAdvisor.Api.dll"]
