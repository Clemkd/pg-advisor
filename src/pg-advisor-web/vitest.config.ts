import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Configuration séparée de vite.config.ts : Vitest embarque sa propre copie des types de Vite,
// qui n'est pas celle du projet, et mélanger les deux fait échouer la vérification des types sur
// la liste des plugins. Les tests n'ont besoin d'aucun plugin — esbuild suffit à transformer le
// TSX avec la transformation JSX automatique.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
