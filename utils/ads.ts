import { Capacitor } from '@capacitor/core';

/**
 * Publicité AdMob — application Android uniquement (le site web n'affiche aucune annonce).
 * Bannière en bas de l'écran, contenu « Tous publics » (G) seulement, annonces non personnalisées.
 * La hauteur de la bannière est exposée dans la variable CSS --ad-h : la barre de navigation remonte
 * d'autant et le contenu garde un espace libre, pour que rien ne soit caché.
 */
export const ADS = {
  appId: 'ca-app-pub-1054414127660059~2854872316', // aussi injecté dans le manifeste Android (workflow APK)
  bannerId: 'ca-app-pub-1054414127660059/7316861504',
  // Annonces de test tant que l'app n'est pas publiée et approuvée par AdMob. Passer à false à la publication.
  testing: true,
};

const setAdHeight = (px: number) => document.documentElement.style.setProperty('--ad-h', `${Math.max(0, Math.round(px))}px`);
let shown = false;

export async function showBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform() || shown) return;
  shown = true;
  try {
    const { AdMob, BannerAdPosition, BannerAdSize, BannerAdPluginEvents, MaxAdContentRating } = await import('@capacitor-community/admob');
    await AdMob.initialize({ maxAdContentRating: MaxAdContentRating.General });
    await AdMob.addListener(BannerAdPluginEvents.SizeChanged, size => setAdHeight(size.height));
    await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => setAdHeight(0));
    await AdMob.showBanner({
      adId: ADS.bannerId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: ADS.testing,
      npa: true, // annonces non personnalisées : pas de profilage publicitaire
    });
  } catch {
    shown = false; setAdHeight(0); // la publicité ne doit jamais bloquer l'application
  }
}

export async function hideBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !shown) return;
  shown = false;
  setAdHeight(0);
  try { const { AdMob } = await import('@capacitor-community/admob'); await AdMob.removeBanner(); } catch { /* ignoré */ }
}
