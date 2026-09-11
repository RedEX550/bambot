# Bambot

A community platform bot and web dashboard, built for a large Bambu Lab Discord.

It is not a general-purpose bot with a Bambu Lab skin. The support workflow, the
knowledge base, the scam filter and the HMS lookup are all shaped around what a
3D-printing community actually deals with every day.

```
┌─────────────┐   gateway    ┌──────────┐
│   Discord   │◄────────────►│   bot    │  discord.js 14 · slash commands · events · jobs
└─────────────┘              └────┬─────┘
                                  │ private HTTP (localhost only)
┌─────────────┐    REST      ┌────┴─────┐
│  dashboard  │◄────────────►│   api    │  Express · Discord OAuth2 · zod validation
│  React/Vite │              └────┬─────┘
└─────────────┘                   │
                             ┌────┴─────┐
                             │ Postgres │  Prisma
                             └──────────┘
```

**Everything in the bot is configured from the dashboard.** Each feature module
declares one zod schema and one list of UI fields, side by side in the same
file. The API validates against that schema, and the dashboard renders the form
from those fields — so a setting cannot exist in the bot without appearing in
the dashboard, and cannot be saved in a shape the bot will not understand.

---

## What it does

**Support**
- Ticket panels with per-category intake forms, claiming, priorities, SLA alerts
- HTML transcripts, CSAT ratings and per-staff performance reporting
- Modmail: members DM the bot, staff answer from a private channel
- Knowledge base powering `/kb` and an opt-in auto-answer in busy channels

**Bambu Lab specific**
- `/hms` decodes error codes and deep-links the exact wiki page for your printer
- `/printer`, `/filament`, `/cost` — line-up, material profiles, print cost maths
- Release watcher for Bambu Studio, OrcaSlicer and the firmware history pages
- MakerWorld link previews and showcase reactions
- A scam scorer tuned for giveaway and support-impersonation DMs

**Moderation**
- Full case book: ban, kick, timeout, warn, note, purge, softban, lockdown
- 12 automod filters with a shared escalation ladder
- Anti-raid: join-rate detection combined with username and account-age signals
- 30+ loggable events routed into the channels you choose

**Community**
- Welcome messages with a server-rendered banner, plus a welcome DM
- Levels with a rendered rank card, role rewards and a leaderboard
- Starboard, suggestions with voting, giveaways, role menus, temp voice, counters
- Reminders, highlights, AFK, tags, sticky messages, scheduled posts

See [`docs/FEATURES.md`](docs/FEATURES.md) for the full list and every command.

---

## Quick start (local)

Requires **Node 20+** and a **PostgreSQL 14+** database.

```bash
git clone <your-repo> bambot && cd bambot
npm install
cp .env.example .env      # then fill it in — see below
npm run db:push           # create the tables
npm run build             # build shared, bot, api and web
npm run deploy:commands   # register slash commands with Discord
npm run dev               # bot + api + dashboard, all watching
```

The dashboard is then on <http://localhost:5173>.

### The four values you must set

| Variable | Where to get it |
| --- | --- |
| `DISCORD_TOKEN` | Developer Portal → your app → Bot → Reset Token |
| `DISCORD_CLIENT_ID` | Developer Portal → your app → General Information |
| `DISCORD_CLIENT_SECRET` | Developer Portal → your app → OAuth2 |
| `DATABASE_URL` | Your Postgres connection string |

Then generate two secrets:

```bash
openssl rand -hex 48   # SESSION_SECRET
openssl rand -hex 32   # INTERNAL_API_KEY
```

### Discord application setup

1. **Bot → Privileged Gateway Intents** — enable **Server Members** and
   **Message Content**. Without them, welcome messages, automod and levelling
   cannot work.
2. **OAuth2 → Redirects** — add exactly what you set as `OAUTH_REDIRECT_URI`.
3. Invite the bot with the link the dashboard shows on the server picker page.

Setting `DEV_GUILD_ID` registers commands to one server instantly instead of
waiting up to an hour for global propagation.

---

## Deploying

Two supported shapes, depending on what you are hosting on.

**A VPS you control** — [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) covers Docker
Compose, HTTPS, backups and upgrades:

```bash
cp .env.example .env && nano .env    # fill in, set POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec api npx prisma db push
docker compose exec bot node packages/bot/dist/scripts/deploy-commands.js
```

**A game panel such as Pterodactyl** — [`docs/PTERODACTYL.md`](docs/PTERODACTYL.md),
with an importable egg at [`deploy/pterodactyl-egg.json`](deploy/pterodactyl-egg.json).
There, everything runs as one process on one port:

```bash
npm start        # = node start.js — bot + API + dashboard together
```

`start.js` boots the gateway client and the API in a single process and serves
the built dashboard from it, so no reverse proxy or second allocation is needed.
Note that Bambot needs **PostgreSQL**; a panel's built-in MySQL database will not
work without a schema migration.

---

## Project layout

```
packages/
  shared/   zod schemas + UI field specs — the contract all three apps share
  bot/      discord.js client: commands, events, services, background jobs
  api/      Express REST API, Discord OAuth2, audit logging
  web/      React + Vite + Tailwind dashboard
prisma/     database schema
deploy/     Dockerfiles, nginx, Caddy, systemd units
docs/       features and deployment
```

### Adding a setting

Add the field to the module's zod schema and to its `ui.sections` — both in the
same file under `packages/shared/src/modules/`. Nothing else needs changing: the
API validates it, the dashboard renders it, and `config.get()` in the bot returns
it fully typed.

---

## Licence

MIT.
