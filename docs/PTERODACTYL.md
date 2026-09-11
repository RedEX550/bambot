# Running Bambot on Pterodactyl

Bambot runs as **one server on one port**: `start.js` boots the Discord bot and
the dashboard API in a single Node process, and the API serves the built
dashboard itself. No nginx, no second allocation, no Docker Compose.

There is one thing to sort out before anything else.

---

## 1. The database — read this first

**Pterodactyl's built-in database feature creates MySQL/MariaDB databases.
Bambot uses PostgreSQL.** You cannot point `DATABASE_URL` at a panel database
and expect it to work — Prisma will refuse to connect.

Pick one of these:

### Option A — free managed PostgreSQL (recommended, ~5 minutes)

Sign up for a free Postgres and paste the connection string into
`DATABASE_URL`. Any of these work and have a free tier that comfortably covers
one Discord server:

- **Neon** — <https://neon.tech>
- **Supabase** — <https://supabase.com> (use the *connection string*, not the REST API)
- **Aiven** — <https://aiven.io>

The container has outbound internet, so this just works. It is also the option
I would pick anyway: your data survives the game server being wiped, reinstalled
or moved, and you get backups without doing anything.

> With Neon and Supabase, append `?sslmode=require` to the connection string if
> the provider does not already include it.

### Option B — PostgreSQL on the machine that runs your panel

If you own the node, install Postgres on the host and let containers reach it:

```bash
sudo apt install -y postgresql
sudo -u postgres createuser bambot --pwprompt
sudo -u postgres createdb bambot -O bambot
```

Then allow the Docker bridge in `/etc/postgresql/*/main/postgresql.conf`
(`listen_addresses = '*'`) and `pg_hba.conf`
(`host bambot bambot 172.17.0.0/16 scram-sha-256`), restart Postgres, and use:

```
postgresql://bambot:yourpassword@172.17.0.1:5432/bambot?schema=public
```

`172.17.0.1` is the host as seen from inside a container.

### Option C — a PostgreSQL egg as a second server

Some panels have a community Postgres egg. If yours does, create one, and point
`DATABASE_URL` at its allocation. Check with whoever runs the panel.

### Option D — you want to use the panel's MySQL

That needs a schema migration: Postgres scalar arrays (`String[]`) have no MySQL
equivalent in Prisma, so about fifteen columns and the queries that touch them
have to move to JSON. It is a contained piece of work — tell me and I will do it.

---

## 2. Import the egg

`deploy/pterodactyl-egg.json` sets up everything: install script, startup
command, and all the environment variables as proper panel fields.

1. Panel → **Admin** → **Nests** → pick or create a nest → **Import Egg**
2. Upload `deploy/pterodactyl-egg.json`
3. **Admin** → **Servers** → **Create New**, and choose the **Bambot** egg

**Resources:**

| | During install | Running |
| --- | --- | --- |
| Memory | **2048 MB** | 1024 MB |
| Disk | 3 GB | 2 GB |
| CPU | 100%+ | 50–100% |

The install builds the dashboard bundle, which is the memory-hungry part. You
can drop memory back to 1 GB after the install finishes.

**Allocations:** one primary allocation is all you need. The two halves talk to
each other over `127.0.0.1:4100` inside the container, which needs no allocation
and is not reachable from outside.

If you prefer the generic **NodeJS** egg instead, see section 7.

---

## 3. Fill in the Startup variables

On the server's **Startup** tab:

| Variable | Value |
| --- | --- |
| `GIT_ADDRESS` | Your repository URL (push this project to GitHub first) |
| `BRANCH` | `main` |
| `DISCORD_TOKEN` | Developer Portal → Bot → Reset Token |
| `DISCORD_CLIENT_ID` | Developer Portal → General Information → Application ID |
| `DISCORD_CLIENT_SECRET` | Developer Portal → OAuth2 → Client Secret |
| `DATABASE_URL` | From step 1 |
| `SESSION_SECRET` | `openssl rand -hex 48` |
| `INTERNAL_API_KEY` | `openssl rand -hex 32` |
| `PUBLIC_URL` | See below |
| `OAUTH_REDIRECT_URI` | `PUBLIC_URL` + `/api/auth/callback` |
| `CORS_ORIGINS` | Same as `PUBLIC_URL` |
| `BOT_OWNER_IDS` | Your Discord user ID |
| `AUTO_MIGRATE` | `1` |
| `AUTO_DEPLOY_COMMANDS` | `1` |

No `.env` file is needed — the panel injects these into the container.

### What `PUBLIC_URL` should be

**If you only have the panel's IP and port**, use it directly:

```
PUBLIC_URL          = http://203.0.113.10:25580
OAUTH_REDIRECT_URI  = http://203.0.113.10:25580/api/auth/callback
CORS_ORIGINS        = http://203.0.113.10:25580
```

This works. Session cookies automatically drop the `Secure` flag when
`PUBLIC_URL` is `http://`, so sign-in still functions.

**If you have a domain**, point a subdomain at the node and put Caddy in front —
you get HTTPS and a link that looks like a product rather than an IP:

```
bambot.yourdomain.com {
    reverse_proxy 203.0.113.10:25580
}
```

Then set all three values to `https://bambot.yourdomain.com` and change
`TRUST_PROXY` to `1`. For the pitch, do this — it matters more than you would
think when a company opens your link.

### Register the redirect with Discord

Developer Portal → your app → **OAuth2** → **Redirects** → add exactly the
`OAUTH_REDIRECT_URI` value. One character off and sign-in bounces back to the
login page.

---

## 4. Turn on the privileged intents

Developer Portal → your app → **Bot** → **Privileged Gateway Intents**:

- **Server Members Intent** — welcome messages, autorole, raid detection
- **Message Content Intent** — automod, levels, auto-responders, HMS detection

The bot connects without them, but those features silently do nothing. This is
the most common "it starts but does not work" cause.

---

## 5. Start it

Press **Start**. On the console you should see, in order:

```
[bambot] syncing database schema...
  Bambot — starting bot and dashboard in one process
  dashboard + api : http://0.0.0.0:25580
  bot internal api: 127.0.0.1:4100 (not exposed)
fonts registered
Bambot is online
slash commands registered globally
serving the dashboard from this process
Bambot API listening
```

The panel marks the server as running when it sees `Bambot API listening`.

Now open `PUBLIC_URL` in a browser and sign in with Discord.

---

## 6. First-run setup in Discord

1. On the server picker, press **Invite** next to your server.
2. Grant the permissions Discord asks for: Manage Channels, Manage Roles,
   Manage Messages, Ban Members, Moderate Members, View Audit Log.
3. **Server Settings → Roles → drag Bambot above every role it must assign.**
   A bot cannot touch a role above its own. This is the number-one support
   question for every Discord bot ever written.
4. Open the server on the dashboard. The overview page lists any permission
   problem it can detect.

Global slash commands can take up to an hour to appear. To get them instantly
while testing, set `DEV_GUILD_ID` to your server's ID and restart — they
register to that one server immediately.

### Seeding the starter knowledge base (optional)

The panel gives you no shell, so run it by temporarily swapping the startup
command. **Startup** tab → change the command to:

```
node /home/container/packages/bot/dist/scripts/seed.js YOUR_GUILD_ID
```

Start the server, wait for `Seeded 12 knowledge base articles`, stop it, then put
the command back to:

```
node /home/container/start.js
```

You can also just write articles on the dashboard under **Knowledge base**.

---

## 7. Using the generic NodeJS egg instead

If you would rather not import a custom egg:

1. Create a server with the **NodeJS Generic** egg, Node 22 image.
2. Set `MAIN_FILE` to `start.js`.
3. Set `GIT_ADDRESS` to your repo and `AUTO_UPDATE` to `1`.
4. Add every variable from the table in step 3 as a custom startup variable.
5. The generic egg only runs `npm install`, so the build has to happen
   somewhere. Either:
   - **build locally and commit the output** — run `npm run build` on your PC and
     commit `packages/*/dist`, or
   - change the startup command to build on first boot:
     ```
     npm install && npx prisma generate && npm run build && npx prisma db push --skip-generate && node start.js
     ```
     then remove everything before `node start.js` once it has succeeded, or it
     rebuilds on every restart.

The custom egg exists because it does all of this properly the first time.

---

## 8. Updating

With `GIT_ADDRESS` set, reinstalling pulls and rebuilds:

**Settings** → **Reinstall Server**. This wipes `/home/container` and clones
again, so **it is only safe because your database lives outside the server.**
Anything you uploaded by hand into the container is lost — keep it in the repo.

If the schema changed, `AUTO_MIGRATE=1` applies it on the next boot.

---

## Troubleshooting

**`db push failed - check DATABASE_URL`**
The database is unreachable or the credentials are wrong. If you are on Option B,
check `pg_hba.conf` allows the Docker subnet. If you used a panel MySQL database,
see section 1 — it will not work.

**Sign-in redirects back to the login page**
`OAUTH_REDIRECT_URI` does not exactly match what is registered in the Discord
portal, or `PUBLIC_URL` and `CORS_ORIGINS` disagree. All three must use the same
scheme, host and port.

**Dashboard loads but every request fails with 401**
You are reaching the dashboard on a different host than `PUBLIC_URL` — for
example via the IP while `PUBLIC_URL` says the domain. The session cookie is
scoped to one origin.

**"Bot offline" badge in the dashboard header**
The API cannot reach the bot half on `127.0.0.1:4100`. In single-process mode
that means the bot failed to log in — check the console for a token error.

**Install fails, killed during `npm run build`**
Not enough memory. Raise the server to 2 GB for the install, or build locally and
commit `packages/*/dist`.

**Welcome banners have no text**
Should not happen — fonts are bundled as a dependency rather than taken from the
host. If it does, the console will say `No fonts could be registered`; reinstall
so `node_modules` is rebuilt, or drop a `.ttf` into `assets/fonts/`.

**Server keeps restarting**
Read the console from the top. A missing required variable prints
`Bambot cannot start: the environment is incomplete` and names the exact field.
