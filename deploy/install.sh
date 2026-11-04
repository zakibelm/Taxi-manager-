#!/usr/bin/env bash
# Installation / mise à jour de Taxi Manager sur un VPS Ubuntu/Debian (Hostinger).
#   curl -fsSL https://raw.githubusercontent.com/zakibelm/Taxi-manager-/main/deploy/install.sh -o install.sh
#   sudo bash install.sh taximanager.partageons.net
# Relancer la même commande met l'application à jour (git pull + build + redémarrage).
# Le secret n8n est demandé au clavier sur le VPS : il ne transite jamais ailleurs.
set -euo pipefail

DOMAIN="${1:-taximanager.partageons.net}"
REPO="https://github.com/zakibelm/Taxi-manager-.git"
APP_DIR=/opt/taximanager
ENV_FILE=/etc/taximanager.env
PORT="${PORT:-3013}"          # 3012 reste libre pour DrivePilot
SERVICE=taximanager

say()  { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
stop() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || stop "Lance ce script avec sudo (ou en root)."
command -v apt-get >/dev/null || stop "Ce script vise Ubuntu/Debian (apt-get introuvable)."

say "Vérification du domaine $DOMAIN"
VPS_IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
echo "IP du VPS : ${VPS_IP:-inconnue} — $DOMAIN pointe vers : ${DNS_IP:-rien}"
if [ -z "$DNS_IP" ] || { [ -n "$VPS_IP" ] && [ "$DNS_IP" != "$VPS_IP" ]; }; then
  stop "Crée d'abord l'enregistrement DNS : type A, nom « ${DOMAIN%%.*} », valeur ${VPS_IP:-<IP du VPS>}, puis relance (la propagation peut prendre quelques minutes)."
fi

say "Paquets système"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

# Ports 80/443 : si un autre serveur web (Traefik/Docker, Caddy…) les occupe déjà, on n'installe PAS nginx
# (mode « proxy externe ») : l'application est installée et la route à ajouter dans ce proxy est générée.
OTHERS=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -o 'users:(("[^"]*' | sed 's/.*"//' | sort -u | grep -vx nginx | tr '\n' ' ' || true)
if [ -n "$OTHERS" ]; then
  PROXY_MODE=external
  # Traefik dans Docker joint l'hôte par le pont docker0 ; sinon (Caddy, Apache sur l'hôte) par la boucle locale.
  BIND=$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
  BIND="${BIND:-127.0.0.1}"
  say "Ports 80/443 déjà utilisés par : $OTHERS → mode proxy externe (nginx non installé, ce proxy n'est pas modifié)"
else
  PROXY_MODE=nginx
  BIND=127.0.0.1
  apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
corepack enable >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null

say "Code de l'application ($APP_DIR)"
id -u "$SERVICE" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" fetch -q origin main && git -C "$APP_DIR" reset -q --hard origin/main
else git clone -q --depth 1 "$REPO" "$APP_DIR"; fi
chown -R "$SERVICE:$SERVICE" "$APP_DIR"
cd "$APP_DIR"
sudo -u "$SERVICE" env HOME="$APP_DIR" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --silent
sudo -u "$SERVICE" env HOME="$APP_DIR" npm run build --silent

if [ ! -f "$ENV_FILE" ]; then
  say "Configuration (une seule fois)"
  read -rsp "Valeur du jeton n8n (identifiant « DrivePilot application - webhook dédié ») : " N8N_TOKEN </dev/tty; echo
  [ -n "$N8N_TOKEN" ] || stop "Jeton n8n vide."
  read -rp "Courriel(s) administrateur [zakibelm66@gmail.com] : " ADMINS </dev/tty
  read -rsp "Clé OpenRouter pour l'assistant (Entrée pour plus tard) : " OPENROUTER </dev/tty; echo
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=$BIND
PORT=$PORT
TRUST_PROXY=1
PUBLIC_URL=https://$DOMAIN
N8N_URL=https://n8n.xtream.space/webhook
N8N_TOKEN=$N8N_TOKEN
N8N_TOKEN_HEADER=X-DrivePilot-Token
N8N_PREFIX=taximanager-tm
ADMIN_EMAILS=${ADMINS:-zakibelm66@gmail.com}
MAIL_PROVIDER=n8n
OPENROUTER_API_KEY=$OPENROUTER
EOF
  chmod 600 "$ENV_FILE"
fi
# Secret HMAC dédié (empreintes d'IP et d'identifiants), distinct du jeton n8n ; ajouté aux installations existantes.
if ! grep -q '^HMAC_SECRET=' "$ENV_FILE"; then
  echo "HMAC_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" >> "$ENV_FILE"
fi
# Adresse d'écoute alignée sur le mode détecté (une relance après un changement de proxy reste cohérente).
sed -i "s/^HOST=.*/HOST=$BIND/" "$ENV_FILE"

say "Service systemd"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Taxi Manager
After=network-online.target

[Service]
User=$SERVICE
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server/main.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q --now $SERVICE
systemctl restart $SERVICE

if [ "$PROXY_MODE" = external ]; then
  ROUTE="$APP_DIR/deploy/route-$SERVICE.yml"
  cat > "$ROUTE" <<EOF
# Route Traefik (fournisseur « file ») : copier dans le dossier de configuration dynamique de Traefik.
http:
  routers:
    $SERVICE:
      rule: "Host(\`$DOMAIN\`)"
      entryPoints: [websecure]
      service: $SERVICE
      tls:
        certResolver: letsencrypt   # adapter au nom du résolveur de ton Traefik
  services:
    $SERVICE:
      loadBalancer:
        servers:
          - url: "http://$BIND:$PORT"
EOF
  sleep 2
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://$BIND:$PORT/api/auth/session" || true)
  [ "$CODE" = 200 ] || { echo "L'application ne répond pas ($CODE). Journal :"; journalctl -u $SERVICE -n 30 --no-pager; exit 1; }
  printf '\n\033[1;32m✔ Taxi Manager tourne sur http://%s:%s\033[0m\n' "$BIND" "$PORT"
  echo "Il reste à brancher $DOMAIN dans le proxy existant ($OTHERS) :"
  echo "  • Traefik : route générée dans $ROUTE (fournisseur file), ou labels équivalents."
  echo "  • Caddy   : $DOMAIN { reverse_proxy $BIND:$PORT }"
  echo "Si ufw filtre docker0 : ufw allow in on docker0 to $BIND port $PORT proto tcp"
  echo "Journal : journalctl -u $SERVICE -f    Mise à jour : relancer ce script."
  exit 0
fi

say "nginx ($DOMAIN → 127.0.0.1:$PORT)"
cat > /etc/nginx/sites-available/$SERVICE <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 64k;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;   # remplace l'en-tête : TRUST_PROXY=1 sans usurpation
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$SERVICE /etc/nginx/sites-enabled/$SERVICE
nginx -t -q && systemctl reload nginx

say "Certificat HTTPS"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$(grep ^ADMIN_EMAILS "$ENV_FILE" | cut -d= -f2 | cut -d, -f1)" --redirect -q || stop "Certbot a échoué (DNS pas encore propagé ?). Relance le script dans quelques minutes."

say "Vérification"
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/auth/session" || true)
if [ "$CODE" = 200 ]; then
  printf '\n\033[1;32m✔ Taxi Manager est en ligne : https://%s\033[0m\n' "$DOMAIN"
  echo "Journal : journalctl -u $SERVICE -f    Mise à jour : relancer ce script."
else
  echo "Réponse inattendue ($CODE). Journal :"; journalctl -u $SERVICE -n 30 --no-pager; exit 1
fi
