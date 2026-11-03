import type { CapacitorConfig } from '@capacitor/cli';

// L'APK affiche l'application hébergée (TAXIMANAGER_URL, en HTTPS) : connexion, cookies et API restent sur la
// même origine, et aucun secret (jeton n8n, clé OpenRouter) n'est jamais embarqué dans l'APK.
// TAXIMANAGER_URL permet de viser un autre serveur (ex. essais) ; par défaut, le serveur de production.
const url = process.env.TAXIMANAGER_URL?.trim() || 'https://taximanager.partageons.net';
if (!/^https:\/\//.test(url)) throw new Error('TAXIMANAGER_URL doit commencer par https://');

const config: CapacitorConfig = {
  appId: 'net.partageons.taximanager',
  appName: 'Taxi Manager',
  webDir: 'dist',
  android: { allowMixedContent: false },
  server: { url, cleartext: false },
};

export default config;
