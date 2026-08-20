# pg-advisor-web

Interface de l'Advisor : React, TypeScript, Vite et Tailwind. Elle est buildée dans
`src/PgAdvisor.Api/wwwroot` et servie par l'API — il n'y a pas de déploiement séparé, et les appels
partent en chemins relatifs vers la même origine.

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement sur le port 5173, `/api` et `/events` relayés vers l'API |
| `npm run build` | Vérification des types puis build de production dans `wwwroot` |
| `npm run lint` | Oxlint |
| `npm run preview` | Sert le build de production |

En développement, l'API visée est celle de `PGADVISOR_API_URL`, à défaut le port du profil de
lancement de `PgAdvisor.Api`. La pile complète se démarre plutôt par Aspire, depuis la racine du
dépôt : `dotnet run --project src/PgAdvisor.AppHost`.

Le contrat d'interface — jetons, densités, primitives — est décrit dans
[`docs/DESIGN.md`](../../docs/DESIGN.md).
