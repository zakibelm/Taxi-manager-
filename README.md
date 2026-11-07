# Taxi Manager

Application Android (APK) et web pour les chauffeurs : saisie des courses, tableau de bord, assistant IA.
Version dédiée, issue de DrivePilot, avec **toutes les données dans des Data Tables n8n** : rien n'est stocké sur le disque du serveur.

```
APK Android (Capacitor) ──HTTPS──► Serveur Taxi Manager (Node) ──X-DrivePilot-Token──► Workflows n8n « … TM » ──► Data Tables taximanager_*_tm
                                                        └──► OpenRouter (assistant, statistiques agrégées seulement)
```

L'APK n'embarque aucun secret : il affiche le site hébergé, et c'est le serveur qui détient le jeton n8n et la clé OpenRouter.

## Données (n8n)

| Data Table | Contenu | Workflow |
|---|---|---|
| `taximanager_accounts_tm` | Comptes (courriel, rôle, confirmé, empreinte scrypt du mot de passe) | Taxi Manager - Comptes et récupération TM |
| `taximanager_account_tokens_tm` | Liens de confirmation et de réinitialisation (hachés, usage unique) | Taxi Manager - Comptes et récupération TM |
| `taximanager_sessions_tm` | Sessions (empreinte SHA-256 du cookie, 8 h) | Taxi Manager - Authentification production TM |
| `taximanager_login_attempts_tm` | Tentatives de connexion (IP et identifiant en empreinte HMAC) | Taxi Manager - Authentification production TM |
| `taximanager_services_tm` | Courses (dont, facultatif, `origin_lat` et `origin_lng` : origine de l'appel arrondie à ≈ 100 m, case « Localiser l'origine de l'appel ») | Taxi Manager - Courses TM |

Les 3 workflows TM sont **actifs**. Leurs webhooks sont sous `https://n8n.xtream.space/webhook/taximanager-tm/api/…` et exigent l'identifiant Header Auth **« DrivePilot application - webhook dédié »** (en-tête `X-DrivePilot-Token`) : `N8N_TOKEN` prend sa valeur. Les workflows DrivePilot eux-mêmes ne sont pas utilisés. Pour séparer complètement les deux applications plus tard, il suffira de créer un identifiant dédié avec le même nom d'en-tête et une autre valeur, puis de le brancher sur les 16 webhooks TM.
Types de service : la liste `SERVICE_TYPES` du serveur, plus ceux ajoutés par un chauffeur avec « Autre… » dans le formulaire de course (enregistrés avec la course, proposés ensuite à ce chauffeur et à l’admin). Les tables `taximanager_service_types_tm` et `taximanager_drivers_tm` existent mais ne sont pas encore utilisées.

## Démarrage

Node.js 22 ou plus, pnpm 10.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local   # puis renseigner N8N_URL, N8N_TOKEN, ADMIN_EMAILS, PUBLIC_URL…
npm run dev                  # http://127.0.0.1:3012
npm test                     # tests serveur avec un faux n8n (aucun appel réseau)
npx tsc --noEmit
```

Production : `npm run build` puis `npm start` derrière un reverse proxy HTTPS (`TRUST_PROXY=1` derrière un seul proxy de confiance : la dernière adresse de `X-Forwarded-For`, celle écrite par le proxy, fait foi).

### Installation sur le VPS (Hostinger)

1. DNS : enregistrement **A** `taximanager` → IP du VPS (domaine `partageons.net`).
2. Dans le terminal du VPS (hPanel › VPS › *Terminal du navigateur*) :

```sh
curl -fsSL https://raw.githubusercontent.com/zakibelm/Taxi-manager-/main/deploy/install.sh -o install.sh
sudo bash install.sh taximanager.partageons.net
```

Le script installe Node 22, nginx et certbot, l'application dans `/opt/taximanager`, le service systemd `taximanager` (port 3013) et le certificat HTTPS. Le jeton n8n est demandé au clavier et rangé dans `/etc/taximanager.env` (permissions 600). Si les ports 80/443 sont déjà pris par un autre serveur web (Traefik dans Docker, Caddy…), le script passe en **mode proxy externe** : il n'installe pas nginx, ne touche pas à ce proxy, fait écouter l'application sur le pont `docker0` (ou `127.0.0.1`) et génère la route Traefik `deploy/route-taximanager.yml` à ajouter à la configuration dynamique. Relancer la même commande met l'application à jour.

| Variable | Usage |
|---|---|
| `N8N_URL` | Base des webhooks : `https://n8n.xtream.space/webhook`. HTTPS obligatoire hors boucle locale. |
| `N8N_TOKEN` | Valeur de l'identifiant Header Auth TM. |
| `HMAC_SECRET` | Clé des empreintes HMAC (IP, identifiants) dans n8n, générée par `install.sh`. À défaut, `N8N_TOKEN` est utilisé. |
| `N8N_TOKEN_HEADER`, `N8N_PREFIX` | Facultatifs : `X-DrivePilot-Token` et `taximanager-tm` par défaut. |
| `ADMIN_EMAILS` | Courriels administrateurs (séparés par des virgules) : l'admin voit les courses de tous les chauffeurs. |
| `ALLOWED_EMAILS` | Chauffeurs autorisés : courriels ou domaines (`@flotte.ca`), séparés par des virgules. Vide : toute adresse confirmée peut s'inscrire (et utiliser l'assistant). Retirer une adresse refuse la connexion et ferme ses sessions. Les admins sont toujours autorisés. **Recommandé en production.** |
| `MAP_TILE_HOST` | Facultatif : hôte HTTPS des tuiles de la carte du tableau de bord, seule origine externe autorisée par la politique de sécurité (images seulement). Défaut : `https://*.tile.openstreetmap.org` (gratuit, attribution affichée). Pour changer de fournisseur, modifier aussi l'URL dans `utils/mapConfig.ts`. |
| `PUBLIC_URL` | Adresse publique utilisée dans les liens des courriels. Obligatoire en production. |
| `MAIL_PROVIDER` | `n8n` (défaut, SMTP du workflow Comptes TM) ou `log` (lien écrit dans le journal du serveur). |
| `SERVICE_TYPES` | Facultatif : types de course proposés. Défaut : Régulier, TCT, Olymel, Bombardier, Handami, James Miron. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Assistant via OmniRoute (API compatible OpenAI). `LLM_MODEL` = combo OmniRoute 100 % gratuit (`taxi-free` par défaut). HTTP accepté uniquement en réseau privé (Tailscale, Docker). |
| `LLM_FREE_MODELS` | Liste (virgules) des modèles gratuits que le chauffeur peut choisir dans le chat. Sur OpenRouter, les modèles non gratuits sont écartés ; sur OmniRoute, ce sont des noms de combos que vous contrôlez. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Clé existante, conservée : utilisée seule si `LLM_BASE_URL` est vide, sinon en repli automatique si OmniRoute échoue. Modèles gratuits uniquement (`openrouter/free` ou `:free`). Les échecs sont écrits dans le journal (`[assistant]`). |

## Comptes

1. **Créer un compte** : nom + courriel. Le compte est créé dans n8n, non confirmé, avec un mot de passe aléatoire inutilisable.
2. Le lien reçu par courriel (24 h, usage unique) permet de **choisir son mot de passe** (12 caractères minimum) : seul le titulaire de la boîte peut le faire.
3. **Mot de passe oublié** : lien valable 1 h. Changer de mot de passe ferme toutes les sessions et invalide les anciens liens.

Si `ALLOWED_EMAILS` est renseignée, seules ces adresses (et les admins) peuvent s'inscrire et se connecter : une adresse non listée reçoit la même réponse publique, mais aucun compte n'est créé et aucun courriel n'est envoyé. Pour donner accès à un chauffeur, ajoute son courriel puis `systemctl restart taximanager` ; pour le retirer, enlève-le de la liste.

Les réponses publiques sont identiques que le compte existe ou non. n8n limite l'envoi à un courriel toutes les 5 minutes par compte. Un courriel listé dans `ADMIN_EMAILS` devient administrateur. Pour le tout premier compte, `MAIL_PROVIDER=log` affiche le lien dans le journal du serveur.

## APK Android

Le workflow GitHub Actions **APK Android** compile l'APK à chaque push sur `main`. Il est téléchargeable dans l'onglet *Actions*, dans l'artefact `TaxiManager-apk`. Pour une version publiée, pousse une étiquette, par exemple `git tag v1.0.0 && git push --tags` : l'APK est alors joint à une *Release*.

L'APK ouvre **https://taximanager.partageons.net** (`capacitor.config.ts`). Pour viser un autre serveur, définis la variable de dépôt `TAXIMANAGER_URL` (*Settings › Secrets and variables › Actions › Variables*).

Signature : si les secrets de dépôt `ANDROID_KEYSTORE_BASE64` (fichier .jks en base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD` sont définis, l'APK est compilé en *release* et signé avec cette clé : les mises à jour s'installent par-dessus sans désinstaller. Sans ces secrets, l'APK reste signé avec la clé de débogage. Créer la clé une fois : `keytool -genkeypair -v -keystore taximanager.jks -alias taximanager -keyalg RSA -keysize 2048 -validity 10000`, puis `base64 -w0 taximanager.jks`. Garder le .jks hors du dépôt : le perdre empêche toute mise à jour de l'APK installé.

## Hors ligne et export

- **Hors ligne** : un service worker garde l'interface en cache. Une course saisie sans réseau est conservée sur le téléphone (marquée « En attente ») et envoyée au retour de la connexion. Chaque course porte un identifiant généré par l'application : un renvoi après coupure ne crée pas de doublon. File et cache sont effacés à la déconnexion.
- **Export CSV** : bouton « Exporter (CSV) » dans *Mes Services*, filtres appliqués (séparateur `;`, montants en $ CA, lisible par Excel en français).

En local, avec Android Studio : `TAXIMANAGER_URL=https://… npx cap add android`, puis `npm run android:sync` et `npm run android:open`.

## Exploitation

- **Supervision** : `GET /api/health` répond 200 (`{"status":"ok"}`) si le serveur tourne et que n8n est configuré, 503 sinon. Aucune session, aucun appel à n8n : à brancher sur Uptime Kuma ou équivalent.
- **Réglages** : au démarrage, le serveur écrit dans le journal un avertissement `[configuration]` pour chaque réglage manquant ou risqué (PUBLIC_URL, HMAC_SECRET, ADMIN_EMAILS, clé OpenRouter, MAIL_PROVIDER=log, ALLOWED_EMAILS vide). `journalctl -u taximanager | grep configuration`.
- **Arrêt propre** : sur `systemctl restart`, les requêtes en cours se terminent (10 s au plus).
- **Tests** : `npm test` couvre le serveur (faux n8n) et la logique de l'application (file hors ligne, isolement des comptes). La CI lance tests, typage et build à chaque push et pull request.

## Sécurité

- Cookie de session HttpOnly, SameSite=Strict, Secure en production. CSP stricte, HSTS, aucun CDN.
- Limitation des tentatives à deux niveaux : local (rafales) et partagé dans n8n (15 minutes, par IP et par compte).
- Le serveur impose le propriétaire des courses : un chauffeur ne voit et ne supprime que les siennes.
- Assistant : seules des statistiques agrégées sont envoyées. Les messages contenant un courriel, un téléphone ou un numéro de carte sont refusés.
- Mode démo : données fictives gardées dans le navigateur, jamais envoyées à n8n ni à OpenRouter.
- Une panne passagère de n8n ne ferme pas les sessions : seule l'absence réelle du compte ou un changement de mot de passe les invalide.
- Conservation (Loi 25) : les workflows TM purgent chaque heure les sessions expirées, les liens expirés et les tentatives de connexion de plus de 15 minutes. Les 3 workflows TM ne conservent aucune donnée d'exécution dans n8n (réglages « Save execution data » à *none*).
