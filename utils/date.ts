/** Format unique des dates affichées (AAAA-MM-JJ, norme fr-CA) pour éviter l'ambiguïté JJ/MM vs MM/JJ. */
export const formatDate = (value: string | Date): string =>
  new Date(value).toLocaleDateString('fr-CA');
