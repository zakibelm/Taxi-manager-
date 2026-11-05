import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './server/plugin.mjs';

export default defineConfig(({ mode }) => {
    const env = { ...loadEnv(mode, '.', ''), ...process.env }; 
    return {
      server: {
        port: 3012,
        strictPort: true,
        host: env.HOST || '127.0.0.1',
        fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.local', '**/server/**'] },
      },
      preview: { host: env.HOST || '127.0.0.1', port: 3012, strictPort: true },
      plugins: [apiPlugin(env), react()],
      build: {
        rollupOptions: {
          // Bibliothèques séparées de l'application : fichiers plus petits, mieux mis en cache entre deux versions.
          output: { manualChunks: { charts: ['recharts'], icons: ['lucide-react'] } },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
