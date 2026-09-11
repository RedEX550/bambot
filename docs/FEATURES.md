# Features

Everything listed here is configured from the dashboard. Nothing requires
editing a file on the server.

---

## Bambu Lab tools

| Command | What it does |
| --- | --- |
| `/hms <code> [printer]` | Normalises any HMS code (`HMS_0300-0300…`, `0300 0300 …`, or 16 bare hex characters), explains the subsystem, lists the usual first checks, and deep-links the exact wiki page for that printer series. |
| `/printer info <model>` | Build volume, enclosure, chamber, nozzle and bed limits, multi-material support, what it is good for, links. |
| `/printer lineup` | The current line-up grouped by series. |
| `/filament <material>` | Nozzle and bed ranges, part cooling, drying schedule, AMS suitability, hardened-nozzle requirement, and the handling notes that actually matter. |
| `/cost <grams> <hours>` | Filament plus electricity cost, with quantity and an assumed failure rate. Defaults are per-server. |

**Automatic behaviour**

- **HMS detection in chat** — someone pastes a code, the bot replies with the decode and the wiki link. Restrictable to specific channels.
- **Release watcher** — polls the Bambu Studio and OrcaSlicer GitHub release APIs and the firmware release-history wiki pages, and announces new versions with the changelog and an optional discussion thread.
- **MakerWorld previews** — expands model links into a preview card, and can auto-react in showcase channels so the starboard picks the best ones up.
- **Knowledge base auto-answer** — watches chosen text and forum channels, and suggests an article when a question closely matches one. Confidence-gated, cooldowned, and offers a "this solved it" button that applies the forum's Solved tag.

> MakerWorld has no public search API — its search endpoint returns nothing to
> server-side requests — so the bot enriches links people post rather than
> pretending to search a catalogue it cannot reach.

---

## Support

### Tickets

- Multiple panels, each with its own channel, style (buttons or dropdown) and set of categories
- Per-category: emoji, label, parent category, channel naming pattern, support roles, ping roles, required/blocked roles, default priority, per-member limit, auto-close timer
- **Intake forms** — up to five modal questions per category, shown before the channel is created, so the first message already contains the printer model, firmware and error code
- Claiming, with an option to lock replies to the claimer
- Priorities, add/remove participants, per-ticket info
- **SLA tracking** — a first-response target with breach alerts to a staff channel
- **HTML transcripts** — self-contained, no external assets, archived to a channel and DM'd to the opener
- **CSAT** — a star rating prompt on close, reported per staff member
- Support hours with an out-of-hours notice
- Ships with seven categories shaped for this community: Printer Support, Order & Shipping, Warranty & RMA, Account & Billing, Report a member, MakerWorld & Contests, Something else

### Modmail

Members DM the bot; staff answer from a private channel with `/modmail reply`.
Anonymous staff replies, cooldowns, minimum time in server, auto-close on
inactivity, and a blocklist.

### Knowledge base and tags

`/kb search` with relevance scoring, `/kb add` for staff, helpful/not-helpful
feedback tracked per article, plus `/tag` for quick canned replies. Both editable
on the dashboard.

---

## Moderation

| Command | |
| --- | --- |
| `/ban` | Permanent or timed, with optional message deletion |
| `/unban`, `/kick`, `/softban` | |
| `/timeout`, `/untimeout` | Duration parsing like `10m`, `1h30m`, `7d` |
| `/warn` | With severity, feeding the threshold ladder |
| `/note` | Private staff note — the member is never told |
| `/case view / reason / pardon / recent` | Full case management |
| `/history` | Everything on record for a member |
| `/purge` | Filter by member, bots, text content or attachments |
| `/slowmode`, `/lock`, `/unlock`, `/lockdown` | |

Every action creates a numbered case, DMs the member (configurable, with an
appeal link), and posts to the mod log. Warn thresholds apply timeouts, kicks or
bans automatically, and warns can be set to expire.

### Automod

Twelve independent filters, each with its own action, exemptions and escalation
points:

`scam` · `invites` · `links` · `words` · `spam` · `duplicates` · `mentions` ·
`caps` · `emoji` · `attachments` · `walls` · `zalgo` · `stickers`

- **Scam scorer** — scores messages against phrase clusters seen in this community: free-printer giveaways, crypto, credential phishing, staff impersonation, Nitro bait, plus lookalike `bambulab.com` domains. Scoring beats a keyword list because "free" alone is harmless while "free printer giveaway click here" is not.
- **Escalation ladder** — points from every filter accumulate per member and decay over a window. Crossing a tier applies a harsher action automatically, and escalation can only make a response harsher, never softer.
- **Strict mode for new accounts** — accounts under a configurable age bypass no filter, even with exempt roles.
- **Trust after N days** — optionally stop filtering long-standing members.
- Letter-substitution matching catches `fr33`, `f r e e`, `f!lament`.

### Anti-raid

Join-rate detection combined with corroborating signals — near-identical
usernames, clusters of brand-new accounts, default avatars. A burst alone is not
treated as a raid, which is what stops a mention on social media from locking the
server down. On detection: quarantine/kick/ban new joins, lock configured
channels, and alert staff with the reasons.

### Logging

30+ events across eight groups (messages, members, moderation, automod, server,
voice, tickets, dashboard). Each group routes to its own channel, and individual
events inside a group can be muted.

---

## Community

- **Welcome** — message, a server-rendered banner (four templates, custom background, colours and avatar shape), and a welcome DM. Anti-abuse guards for account age and rejoins.
- **Goodbye** — with the option to stay quiet on kicks and bans.
- **Levels** — message and voice XP, cooldowns, per-role and per-channel multipliers, a configurable curve, a rendered rank card, role rewards, and a leaderboard.
- **Starboard** — threshold, emoji, self-star and bot-message rules, live count, and removal when unstarred.
- **Suggestions** — direct or staff-reviewed, voting, auto-threads, cooldowns, account-age gating, DM on status change.
- **Giveaways** — button entry, eligibility rules (account age, time in server, level, roles), bonus entries per role, weighted draw, claim windows and rerolls.
- **Role menus** — buttons or dropdowns, with a never-assignable safety list and a per-member cap.
- **Temp voice** — join-to-create rooms with an owner control panel and automatic cleanup.
- **Stat channels** — live member, booster and open-ticket counters, respecting Discord's two-renames-per-ten-minutes limit.
- **Verification** — button, code challenge or rules acceptance, with a gate role and an optional kick timer.
- **Utilities** — `/remind`, `/afk`, `/highlight`, `/userinfo`, `/serverinfo`, `/avatar`, `/help`, plus sticky messages, auto-responders and cron-scheduled posts.

---

## Dashboard

- Discord OAuth2 sign-in, restricted to servers where you have Manage Server
- Live channel, role and emoji pickers that grey out anything the bot cannot use
- A **message editor with a Discord-accurate preview** — embeds, fields, buttons, and a variable inserter that respects your cursor position
- **Welcome preview rendered by the bot itself**, with a real member, so font and URL problems show up before members do
- Ticket panel and category builders, including the intake form builder
- Analytics: growth, messages, support load, response times, CSAT, top commands
- Ticket queue with per-staff performance, and transcripts viewable in the browser
- Searchable case book with pardons and reason edits
- Knowledge base and tag editors
- Audit log of every dashboard change, with before/after payloads
- Config export and import as JSON

---

## Operational notes

- Analytics are written to a pre-aggregated daily table, and message counts are batched in memory and flushed once a minute, so a busy server does not hammer Postgres.
- Config reads are cached for 60 seconds per guild per module and invalidated immediately on save.
- Every config read is re-validated through its zod schema, so a row written by an older build comes back with new defaults filled in.
- The bot's internal API binds to localhost and requires a shared secret; the dashboard can only invoke an allow-listed set of actions, and the guild ID always comes from the verified route rather than the request body.
- Transcripts are served with a restrictive `Content-Security-Policy` as defence in depth on top of escaping.
- Old analytics rows, automod hits and fired reminders are pruned nightly.
