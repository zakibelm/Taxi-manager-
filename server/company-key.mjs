/** Clé de comparaison d'un nom de compagnie : sans accents, sans casse, espaces regroupés. « Taxi  Été » = « taxi ete ». */
export const companyKey = value => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
