import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Le SPA est compilé dans wwwroot de l'API : ASP.NET Core sert les assets en production.
// En développement, le proxy évite les problèmes de CORS et de cookie d'authentification.
//
// L'AppHost Aspire injecte l'adresse de l'API sous la forme services__<ressource>__<liaison>__<n>
// et attribue le port du serveur Vite. Hors Aspire, on retombe sur le profil de lancement de
// PgAdvisor.Api, surchargeable par PGADVISOR_API_URL.
const apiTarget =
  process.env.services__api__http__0 ?? process.env.PGADVISOR_API_URL ?? 'http://localhost:5153'
const devPort = Number(process.env.PORT ?? 5173)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    outDir: '../PgAdvisor.Api/wwwroot',
    emptyOutDir: true,
  },
  server: {
    port: devPort,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/events': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
