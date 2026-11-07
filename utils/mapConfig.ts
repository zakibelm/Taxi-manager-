/** Fond de carte gratuit : OpenStreetMap (attribution obligatoire, usage raisonnable). Pour changer de fournisseur,
 *  modifier l'URL ici ET l'hôte autorisé côté serveur (variable MAP_TILE_HOST, voir README). */
export const MAP_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a>',
  maxZoom: 18,
};

/** Couleurs des niveaux d'achalandage (vert = forte, jaune = moyenne, rouge = faible). */
export const LEVEL_STYLE = {
  forte: { label: 'Forte', color: '#16a34a' },
  moyenne: { label: 'Moyenne', color: '#eab308' },
  faible: { label: 'Faible', color: '#dc2626' },
} as const;
