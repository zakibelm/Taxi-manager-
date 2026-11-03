# Taxi Manager

Application Android (APK) et web pour les chauffeurs : saisie des courses, tableau de bord, assistant IA.
Version dédiée, issue de DrivePilot, avec **toutes les données dans des Data Tables n8n** : rien n'est stocké sur le disque du serveur.

```
APK Android (Capacitor) ──HTTPS──► Serveur Taxi Manager (Node) ──X-TaxiManager-Token──► Workflows n8n « … TM » ──► Data Tables taximanager_*_tm
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
| `taximanager_services_tm` | Courses | Taxi Manager - Courses TM |

Les webhooks sont sous `…/webhook/taximanager-tm/api/…` et exigent l'identifiant Header Auth **« Taxi Manager TM - webhook dédié »** (en-tête `X-TaxiManager-Token`). Les workflows DrivePilot ne sont pas utilisés.
Les tables `taximanager_service_types_tm` et `taximanager_drivers_tm` existent mais ne sont pas encore utilisées.

## Démarrage

Node.js 22 ou plus, pnpm 10.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local   # puis renseigner N8N_URL, N8N_TOKEN, ADMIN_EMAILS, PUBLIC_URL…
npm run dev                  # http://127.0.0.1:3012
npm test                     # tests serveur avec un faux n8n (aucun appel réseau)
npx tsc --noEmit
```

Production : `npm run build` puis `npm start` derrière un reverse proxy HTTPS (`TRUST_PROXY=1` seulement si ce proxy remplace `X-Forwarded-For`).

| Variable | Usage |
|---|---|
| `N8N_URL` | Base des webhooks, ex. `https://n8n.xtream.space/webhook`. HTTPS obligatoire hors boucle locale. |
| `N8N_TOKEN` | Valeur de l'identifiant Header Auth TM. Sert aussi de clé HMAC pour les empreintes d'IP. |
| `N8N_TOKEN_HEADER`, `N8N_PREFIX` | Facultatifs : `X-TaxiManager-Token` et `taximanager-tm` par défaut. |
| `ADMIN_EMAILS` | Courriels administrateurs (séparés par des virgules) : l'admin voit les courses de tous les chauffeurs. |
| `PUBLIC_URL` | Adresse publique utilisée dans les liens des courriels. Obligatoire en production. |
| `MAIL_PROVIDER` | `n8n` (défaut, SMTP du workflow Comptes TM) ou `log` (lien écrit dans le journal du serveur). |
| `SERVICE_TYPES` | Facultatif : types de course proposés. Défaut : Régulier, TCT, Olymel, Bombardier, Handami, James Miron. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Assistant ; modèle `openrouter/free` par défaut. |

## Comptes

1. **Créer un compte** : nom + courriel. Le compte est créé dans n8n, non confirmé, avec un mot de passe aléatoire inutilisable.
2. Le lien reçu par courriel (24 h, usage unique) permet de **choisir son mot de passe** (12 caractères minimum) : seul le titulaire de la boîte peut le faire.
3. **Mot de passe oublié** : lien valable 1 h. Changer de mot de passe ferme toutes les sessions et invalide les anciens liens.

Les réponses publiques sont identiques que le compte existe ou non. n8n limite l'envoi à un courriel toutes les 5 minutes par compte. Un courriel listé dans `ADMIN_EMAILS` devient administrateur. Pour le tout premier compte, `MAIL_PROVIDER=log` affiche le lien dans le journal du serveur.

## APK Android

Le workflow GitHub Actions **APK Android** compile l'APK à chaque push sur `main`. Il est téléchargeable dans l'onglet *Actions*, dans l'artefact `TaxiManager-apk`. Pour une version publiée, pousse une étiquette, par exemple `git tag v1.0.0 && git push --tags` : l'APK est alors joint à une *Release*.

Avant la première compilation, définis la variable de dépôt **`TAXIMANAGER_URL`** (*Settings › Secrets and variables › Actions › Variables*) avec l'adresse HTTPS du serveur Taxi Manager. Sans elle, l'APK ne fonctionne qu'en mode démo.

L'APK est signé avec la clé de débogage Android, ce qui suffit pour l'installer directement sur les téléphones (autoriser les sources inconnues). Une publication sur Google Play demandera une clé de signature dédiée.

En local, avec Android Studio : `TAXIMANAGER_URL=https://… npx cap add android`, puis `npm run android:sync` et `npm run android:open`.

## Sécurité

- Cookie de session HttpOnly, SameSite=Strict, Secure en production. CSP stricte, HSTS, aucun CDN.
- Limitation des tentatives à deux niveaux : local (rafales) et partagé dans n8n (15 minutes, par IP et par compte).
- Le serveur impose le propriétaire des courses : un chauffeur ne voit et ne supprime que les siennes.
- Assistant : seules des statistiques agrégées sont envoyées. Les messages contenant un courriel, un téléphone ou un numéro de carte sont refusés.
- Mode démo : données fictives gardées dans le navigateur, jamais envoyées à n8n ni à OpenRouter.
