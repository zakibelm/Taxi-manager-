import type { CapacitorConfig } from '@capacitor/cli';

// L'APK affiche l'application hébergée (TAXIMANAGER_URL, en HTTPS) : connexion, cookies et API restent sur la
// même origine, et aucun secret (jeton n8n, clé OpenRouter) n'est jamais embarqué dans l'APK.
// Sans TAXIMANAGER_URL, l'APK n'embarque que l'interface : seul le mode démo fonctionne.
const url = process.env.TAXIMANAGER_URL?.trim();
if (url && !/^https:\/\//.test(url)) throw new Error('TAXIMANAGER_URL doit commencer par https://');

const config: CapacitorConfig = {
  appId: 'net.partageons.taximanager',
  appName: 'Taxi Manager',
  webDir: 'dist',
  android: { allowMixedContent: false },
  ...(url ? { server: { url, cleartext: false } } : {}),
};

export default config;
