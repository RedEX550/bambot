import { createHash } from "node:crypto";
import { EmbedBuilder, type Guild } from "discord.js";
import { COLORS } from "@bambot/shared";
import type { BambotClient } from "../core/client";
import { prisma } from "../core/db";
import { childLogger } from "../core/logger";
import { clamp } from "../lib/embeds";

const log = childLogger("releases");

/**
 * Release watching.
 *
 * Two different mechanisms, because the two sources are genuinely different:
 *
 *  - Bambu Studio and OrcaSlicer publish GitHub Releases, which is a real API
 *    with a version, a body and a timestamp. Those announcements are rich.
 *  - Printer firmware is published as wiki pages with no feed. For those the
 *    watcher hashes the rendered page and announces "this page changed, here is
 *    the link" — deliberately modest, because claiming to know the version
 *    number from a scrape would eventually be wrong.
 */

interface SourceDefinition {
  key: string;
  label: string;
  kind: "github" | "wiki";
  /** repo for github, url for wiki */
  target: string;
  emoji: string;
}

export const SOURCES: Record<string, SourceDefinition> = {
  bambustudio: { key: "bambustudio", label: "Bambu Studio", kind: "github", target: "bambulab/BambuStudio", emoji: "🖥️" },
  orcaslicer: { key: "orcaslicer", label: "OrcaSlicer", kind: "github", target: "SoftFever/OrcaSlicer", emoji: "🐋" },
  "firmware-x1": {
    key: "firmware-x1",
    label: "X1 / X1C firmware",
    kind: "wiki",
    target: "https://wiki.bambulab.com/en/x1/manual/X1-X1C-firmware-release-history",
    emoji: "🖨️",
  },
  "firmware-p1": {
    key: "firmware-p1",
    label: "P1P / P1S firmware",
    kind: "wiki",
    target: "https://wiki.bambulab.com/en/p1/manual/p1p-firmware-release-history",
    emoji: "🖨️",
  },
  "firmware-a1": {
    key: "firmware-a1",
    label: "A1 / A1 mini firmware",
    kind: "wiki",
    target: "https://wiki.bambulab.com/en/a1/manual/a1-firmware-release-history",
    emoji: "🖨️",
  },
  "firmware-h2": {
    key: "firmware-h2",
    label: "H2 series firmware",
    kind: "wiki",
    target: "https://wiki.bambulab.com/en/h2d/manual/h2d-firmware-release-history",
    emoji: "🖨️",
  },
};

interface GithubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Bambot-release-watcher",
      },
    });
    clearTimeout(timer);
    if (!response.ok) {
      log.debug({ url, status: response.status }, "release fetch returned non-ok");
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    log.debug({ err, url }, "release fetch failed");
    return null;
  }
};

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Bambot-release-watcher" } });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
};

/** Strips markdown that reads badly inside an embed and trims to length. */
const tidyBody = (body: string): string =>
  clamp(
    body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/#{1,6}\s?/g, "**")
      .replace(/\r/g, "")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(0, 20)
      .join("\n"),
    1500,
  );

const pollGithub = async (source: SourceDefinition, includePrerelease: boolean) => {
  const releases = await fetchJson<GithubRelease[]>(`https://api.github.com/repos/${source.target}/releases?per_page=5`);
  if (!releases?.length) return;

  for (const release of releases.reverse()) {
    if (release.draft) continue;
    if (release.prerelease && !includePrerelease) continue;

    await prisma.releaseWatch
      .upsert({
        where: { source_externalId: { source: source.key, externalId: String(release.id) } },
        create: {
          source: source.key,
          externalId: String(release.id),
          title: release.name || release.tag_name,
          version: release.tag_name,
          url: release.html_url,
          body: tidyBody(release.body ?? ""),
          publishedAt: new Date(release.published_at),
          announced: false,
        },
        update: {},
      })
      .catch((err) => log.debug({ err }, "release upsert failed"));
  }
};

const pollWiki = async (source: SourceDefinition) => {
  const html = await fetchText(source.target);
  if (!html) return;

  // Hash only the main content region so nav or footer churn does not fire.
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const main = body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body;
  const text = main.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 200) return;

  const hash = createHash("sha256").update(text).digest("hex").slice(0, 32);

  const existing = await prisma.releaseWatch.findFirst({ where: { source: source.key }, orderBy: { publishedAt: "desc" } });

  // First run establishes the baseline without announcing history.
  if (!existing) {
    await prisma.releaseWatch
      .create({
        data: {
          source: source.key,
          externalId: hash,
          title: source.label,
          url: source.target,
          body: "",
          publishedAt: new Date(),
          announced: true,
        },
      })
      .catch(() => undefined);
    return;
  }

  if (existing.externalId === hash) return;

  // Try to pull the newest version-looking string off the page for the title.
  const version = text.match(/\b\d{2}\.\d{2}\.\d{2}\.\d{2}\b/)?.[0] ?? text.match(/\bv?\d+\.\d+\.\d+(?:\.\d+)?\b/)?.[0] ?? null;

  await prisma.releaseWatch
    .create({
      data: {
        source: source.key,
        externalId: hash,
        title: version ? `${source.label} — ${version}` : `${source.label} updated`,
        version,
        url: source.target,
        body: "The firmware release history page changed. Open the link for the full notes.",
        publishedAt: new Date(),
        announced: false,
      },
    })
    .catch(() => undefined);
};

const announce = async (client: BambotClient, guild: Guild) => {
  const cfg = await client.config.get(guild.id, "bambu");
  if (!cfg.enabled || !cfg.releases.enabled || !cfg.releases.channelId) return;

  const channel = guild.channels.cache.get(cfg.releases.channelId);
  if (!channel?.isTextBased()) return;

  const pending = await prisma.releaseWatch.findMany({
    where: { announced: false, source: { in: cfg.releases.sources } },
    orderBy: { publishedAt: "asc" },
    take: 5,
  });

  for (const release of pending) {
    const source = SOURCES[release.source];
    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`${source?.emoji ?? "📦"} ${clamp(release.title, 240)}`)
      .setURL(release.url)
      .setTimestamp(release.publishedAt)
      .setFooter({ text: source?.label ?? release.source });

    if (release.body) embed.setDescription(release.body);
    if (release.version) embed.addFields({ name: "Version", value: release.version, inline: true });

    const message = await channel
      .send({ content: cfg.releases.pingRoleId ? `<@&${cfg.releases.pingRoleId}>` : undefined, embeds: [embed] })
      .catch((err) => {
        log.debug({ err }, "release announcement failed");
        return null;
      });

    if (message && cfg.releases.createThread && "threads" in channel) {
      await message.startThread({ name: clamp(release.title, 90), autoArchiveDuration: 4320 }).catch(() => undefined);
    }
  }

  if (pending.length) {
    await prisma.releaseWatch
      .updateMany({ where: { id: { in: pending.map((r) => r.id) } }, data: { announced: true } })
      .catch(() => undefined);
  }
};

export const checkReleases = async (client: BambotClient) => {
  // Work out which sources any guild actually wants, so an unused source is
  // never fetched. At one guild this is trivial; it matters if Bambot is shared.
  const wanted = new Set<string>();
  let includePrerelease = false;

  for (const guild of client.guilds.cache.values()) {
    const cfg = await client.config.get(guild.id, "bambu");
    if (!cfg.enabled || !cfg.releases.enabled) continue;
    for (const source of cfg.releases.sources) wanted.add(source);
    if (cfg.releases.includePrerelease) includePrerelease = true;
  }

  for (const key of wanted) {
    const source = SOURCES[key];
    if (!source) continue;
    if (source.kind === "github") await pollGithub(source, includePrerelease);
    else await pollWiki(source);
  }

  for (const guild of client.guilds.cache.values()) {
    await announce(client, guild).catch((err) => log.debug({ err }, "announce failed"));
  }
};
