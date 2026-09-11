# Deploying Bambot on a VPS

Written for a fresh Ubuntu 22.04 / 24.04 or Debian 12 box. Two routes are
covered: **Docker Compose** (recommended) and **bare metal with systemd**.

A 2 GB / 1 vCPU VPS is enough for a single large server. 4 GB is comfortable if
you also run Postgres backups and a reverse proxy on the same box.

---

## 1. Before you touch the server

Set up the Discord application first, because two values here must match the
server's public URL exactly.

1. Go to <https://discord.com/developers/applications> and create an application.
2. **Bot** tab → **Reset Token** → copy it. This is `DISCORD_TOKEN`.
3. **Bot** tab → **Privileged Gateway Intents** → turn on:
   - **Server Members Intent** — welcome messages, autorole, raid detection
   - **Message Content Intent** — automod, levelling, auto-responders
   
   The bot will connect without these but most features will silently do nothing.
4. **OAuth2** tab → copy the **Client ID** and **Client Secret**.
5. **OAuth2 → Redirects** → add `https://your-domain.com/api/auth/callback`.
   This must be character-for-character identical to `OAUTH_REDIRECT_URI` later.

> Under 100 servers no verification is needed. Above that, Discord requires
> application verification before privileged intents keep working.

---

## 2. Prepare the server

```bash
ssh root@your-server-ip

# A non-root user to run everything as
adduser --disabled-password --gecos "" bambot
usermod -aG sudo bambot

# Basic firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker bambot
```

Log back in as `bambot` so the docker group membership applies:

```bash
su - bambot
```

---

## 3. Get the code and configure it

```bash
git clone <your-repo> /home/bambot/bambot
cd /home/bambot/bambot
cp .env.example .env
```

Generate the secrets:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 48)"
echo "INTERNAL_API_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
```

Then edit `.env`. A working production file looks like this:

```ini
# Discord
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_CLIENT_SECRET=your-oauth2-secret
DEV_GUILD_ID=

# Database — the host must be `db`, which is the compose service name
POSTGRES_USER=bambot
POSTGRES_PASSWORD=the-value-you-just-generated
POSTGRES_DB=bambot
DATABASE_URL=postgresql://bambot:the-value-you-just-generated@db:5432/bambot?schema=public

# API + dashboard
API_PORT=4000
WEB_PORT=8080
SESSION_SECRET=the-48-byte-value-you-generated
PUBLIC_URL=https://bambot.your-domain.com
OAUTH_REDIRECT_URI=https://bambot.your-domain.com/api/auth/callback
CORS_ORIGINS=https://bambot.your-domain.com

# Bot internal API — never exposed publicly
BOT_INTERNAL_PORT=4100
BOT_INTERNAL_URL=http://bot:4100
INTERNAL_API_KEY=the-32-byte-value-you-generated

# Behaviour
NODE_ENV=production
LOG_LEVEL=info
BOT_OWNER_IDS=your-discord-user-id
TRANSCRIPT_DIR=./data/transcripts
```

**Three things that break deployments, in order of frequency:**

1. `PUBLIC_URL`, `OAUTH_REDIRECT_URI` and `CORS_ORIGINS` must all use the same
   scheme and host. Mixing `http` and `https`, or `www` and bare, breaks sign-in.
2. `OAUTH_REDIRECT_URI` must be registered in the Discord portal, exactly.
3. `INTERNAL_API_KEY` must be the same for the bot and the API. They are in the
   same `.env` here, so this only bites if you split them onto separate hosts.

Lock the file down — it holds your bot token:

```bash
chmod 600 .env
```

---

## 4. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then create the database tables:

```bash
docker compose exec api npx prisma db push
```

Register the slash commands:

```bash
docker compose exec bot node packages/bot/dist/scripts/deploy-commands.js
```

Global commands can take up to an hour to appear. To get them instantly in one
server while testing, set `DEV_GUILD_ID` in `.env`, restart, and run the command
again.

Check everything is healthy:

```bash
docker compose ps
curl -s localhost:8080/api/health
docker compose logs -f bot
```

You should see `Bambot is online` in the bot logs.

---

## 5. HTTPS

The `web` container listens on `WEB_PORT` (8080 by default) over plain HTTP.
Put a TLS terminator in front of it. Caddy is the least work:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Put this in `/etc/caddy/Caddyfile` (there is a copy in `deploy/Caddyfile`):

```
bambot.your-domain.com {
    encode gzip zstd
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Point the subdomain's DNS A record at the server first — Caddy gets the
certificate automatically on the first request.

Once HTTPS works, stop exposing the raw port to the internet:

```bash
sudo ufw delete allow 8080   # if you ever opened it
```

---

## 6. Invite the bot and set it up

1. Open `https://bambot.your-domain.com` and sign in with Discord.
2. On the server picker, press **Invite** next to your server.
3. Grant the permissions Discord asks for. The bot needs **Manage Channels**
   (tickets), **Manage Roles** (verification, autorole, levels), **Manage
   Messages** (automod), **Ban Members**, **Moderate Members** and
   **View Audit Log**.
4. **In Discord, drag Bambot's role above every role it must assign.** A bot
   cannot touch a role positioned above its own. This is the single most common
   "it is not working" cause.
5. Back on the dashboard, open the server. The overview page lists any
   permission problems it can detect.

Optionally seed a starter knowledge base — twelve articles covering first-layer
adhesion, AMS jams, drying, HMS codes, scams and so on:

```bash
docker compose exec bot node packages/bot/dist/scripts/seed.js YOUR_GUILD_ID
```

Everything it writes is editable on the dashboard afterwards.

---

## 7. Day-to-day operations

**Update to a new version**

```bash
cd /home/bambot/bambot
git pull
docker compose up -d --build
docker compose exec api npx prisma db push          # only if the schema changed
docker compose exec bot node packages/bot/dist/scripts/deploy-commands.js
```

**Logs**

```bash
docker compose logs -f bot
docker compose logs -f api
docker compose logs --tail 200 bot | grep -i error
```

**Back up the database** — do this before every upgrade, and nightly:

```bash
docker compose exec -T db pg_dump -U bambot bambot | gzip > ~/bambot-$(date +%F).sql.gz
```

A nightly cron, keeping 14 days:

```bash
crontab -e
# 0 3 * * * cd /home/bambot/bambot && docker compose exec -T db pg_dump -U bambot bambot | gzip > ~/backups/bambot-$(date +\%F).sql.gz && find ~/backups -name 'bambot-*.sql.gz' -mtime +14 -delete
```

**Restore**

```bash
gunzip -c ~/bambot-2026-09-11.sql.gz | docker compose exec -T db psql -U bambot bambot
```

**Restart one service**

```bash
docker compose restart bot
```

---

## 8. Without Docker

If you would rather run it directly:

```bash
# Node 22 and Postgres
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql nginx

sudo -u postgres createuser bambot --pwprompt
sudo -u postgres createdb bambot -O bambot

sudo mkdir -p /opt/bambot && sudo chown bambot:bambot /opt/bambot
git clone <your-repo> /opt/bambot && cd /opt/bambot
cp .env.example .env && nano .env      # DATABASE_URL host is localhost here
npm ci
npm run build
npm run db:push
npm run deploy:commands

sudo cp deploy/bambot-bot.service deploy/bambot-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bambot-bot bambot-api
```

Then serve `packages/web/dist` with nginx and proxy `/api` to `127.0.0.1:4000` —
`deploy/nginx.conf` is the config, with `proxy_pass http://api:4000` changed to
`http://127.0.0.1:4000`.

```bash
sudo journalctl -u bambot-bot -f
```

---

## Troubleshooting

**Sign-in bounces back to the login page**
`OAUTH_REDIRECT_URI` does not match the Discord portal exactly, or `PUBLIC_URL`
and `CORS_ORIGINS` disagree about the scheme or host. Check all three.

**"Bot offline" in the dashboard header**
The API cannot reach the bot's internal API. Check `docker compose ps` shows
`bot` healthy, and that `INTERNAL_API_KEY` is identical for both.

**Commands do not appear in Discord**
Global registration takes up to an hour. Set `DEV_GUILD_ID` and re-run
`deploy-commands.js` for instant registration in one server.

**Welcome messages, automod or levels do nothing**
The privileged intents are off. Turn on Server Members and Message Content in
the Developer Portal, then restart the bot.

**"I cannot assign that role"**
Bambot's own role sits below the role it is trying to give out. Move it up in
Server Settings → Roles.

**Tickets fail to open**
The bot is missing Manage Channels, or the configured parent category was
deleted. The overview page flags both.

**Welcome banner text renders as boxes**
The host has no fonts. The Docker image installs `fonts-dejavu-core`; on bare
metal, `sudo apt install fonts-dejavu-core`.

**Database connection refused on first boot**
Postgres is still starting. Compose waits for its healthcheck, so this resolves
itself — `docker compose logs db` will show when it is ready.
