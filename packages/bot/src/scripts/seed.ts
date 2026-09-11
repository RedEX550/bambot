/**
 * Seeds a guild with a starter knowledge base and tag set.
 *
 *   node packages/bot/dist/scripts/seed.js <guildId>
 *
 * Everything written here is editable from the dashboard afterwards — this is a
 * starting point, not a fixture. Articles are the ones that answer the most
 * repeated questions in a 3D-printing community, so the auto-answer feature has
 * something useful to match against on day one.
 */

import { prisma } from "../core/db";
import { logger } from "../core/logger";

interface SeedArticle {
  slug: string;
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  content: string;
}

const ARTICLES: SeedArticle[] = [
  {
    slug: "first-layer-not-sticking",
    title: "First layer will not stick",
    summary: "Almost always a dirty plate rather than a levelling problem.",
    category: "printing",
    keywords: ["first layer", "adhesion", "not sticking", "warping", "lifting", "bed", "plate", "peeling"],
    content:
      "**Nine times out of ten this is a dirty plate, not levelling.**\n\n" +
      "1. Wash the plate with warm water and dish soap, then dry it with a clean towel. IPA alone smears finger oil around rather than removing it.\n" +
      "2. Handle the plate by the edges from then on.\n" +
      "3. Run a full bed levelling from the printer screen.\n" +
      "4. Check you are using the right plate profile in the slicer — a Cool Plate profile on a Textured PEI plate prints too cold to stick.\n" +
      "5. For ABS/ASA and other warping materials, close the enclosure and add a brim.\n\n" +
      "If the first layer is squashed or has gaps in only one area, the plate may be warped — open a ticket with a photo.",
  },
  {
    slug: "ams-filament-jam",
    title: "AMS keeps jamming or failing to feed",
    summary: "Usually a tangled spool, a blunt filament end, or wet filament.",
    category: "ams",
    keywords: ["ams", "jam", "jammed", "feed", "feeding", "tangle", "tangled", "snapped", "0700", "filament stuck"],
    content:
      "**Check these in order:**\n\n" +
      "1. **Spool tangle** — the most common cause by far. Open the AMS, unwind a metre and check the filament has not slipped under itself on the spool.\n" +
      "2. **The filament end** — cut it at a clean 45° angle. A blunt or blobby end catches on the PTFE path.\n" +
      "3. **A snapped piece** — look inside the PTFE tubes and the hub for a broken fragment left from a previous failure.\n" +
      "4. **Wet filament** — dry PLA snaps inside the AMS. If it keeps breaking, dry the spool at 55 °C for 8 hours.\n" +
      "5. **Spool shape** — cardboard spools shed dust and oversized spools bind. Both cause feed errors.\n\n" +
      "Error codes starting `0700` are AMS feed errors. Run `/hms` with the full code for the exact page.",
  },
  {
    slug: "drying-filament",
    title: "How to dry filament, and when you need to",
    summary: "Popping, stringing and brittle filament all point at moisture.",
    category: "filament",
    keywords: ["dry", "drying", "wet", "moisture", "stringing", "popping", "crackling", "brittle", "dehydrator"],
    content:
      "**Signs of wet filament:** popping or crackling from the nozzle, heavy stringing, a rough or foamy surface, and filament that snaps when bent.\n\n" +
      "**Typical drying settings**\n" +
      "• PLA / PVA — 55 °C for 8 hours\n" +
      "• PETG — 65 °C for 8 hours\n" +
      "• ABS / ASA — 80 °C for 8 hours\n" +
      "• PA (nylon) and PA-CF — 80 °C for 12 hours\n\n" +
      "Nylon re-absorbs moisture within hours, so print it straight from a dryer. Keep desiccant in the AMS and replace it when the indicator turns pink.\n\n" +
      "Use `/filament <material>` for the full profile for any material.",
  },
  {
    slug: "hms-error-codes",
    title: "What an HMS error code means",
    summary: "How to read the code and find the exact fix.",
    category: "errors",
    keywords: ["hms", "error", "code", "error code", "fault", "warning", "what does", "0300", "0700"],
    content:
      "HMS codes look like `0300-0300-0001-0001`. The first group identifies the subsystem:\n\n" +
      "• `0200` — motion, belts, homing\n" +
      "• `0300` — hotend, fans, temperature\n" +
      "• `0500` — toolhead control board\n" +
      "• `0700` — AMS filament feed\n" +
      "• `07FF` — AMS system level\n" +
      "• `0C00` — heatbed and levelling\n" +
      "• `1200` — mainboard and firmware\n\n" +
      "**Run `/hms <code>`** and the bot decodes the subsystem, lists the usual first steps and links the exact page on the official wiki.\n\n" +
      "You can also scan the QR code on the printer screen or in Bambu Studio — it opens the same page.",
  },
  {
    slug: "nozzle-clogged",
    title: "Nozzle is clogged or under-extruding",
    summary: "Cold pull first; replace the nozzle if it keeps coming back.",
    category: "printing",
    keywords: ["clog", "clogged", "blocked", "under extrusion", "underextrusion", "no filament", "gaps", "thin layers"],
    content:
      "**Partial clog** (thin or patchy extrusion):\n" +
      "1. Heat the nozzle to 250 °C and push filament through by hand.\n" +
      "2. Do a cold pull: heat to 250 °C, load PLA, cool to 90 °C, then pull the filament out firmly. Repeat until what comes out is clean.\n\n" +
      "**Full clog** (nothing comes out):\n" +
      "1. Remove the nozzle while hot and inspect it.\n" +
      "2. Check for a blob of cooked filament above the nozzle — that usually means a previous failure was not fully cleaned up.\n\n" +
      "**If it keeps recurring**, the cause is usually one of: printing abrasive filament through a brass nozzle, an enclosed printer running PLA too hot, or wet filament. Carbon-fibre and glow-in-the-dark filaments need a hardened nozzle.",
  },
  {
    slug: "abs-warping",
    title: "ABS and ASA warping or splitting",
    summary: "Heat management, not settings, is what fixes this.",
    category: "printing",
    keywords: ["abs", "asa", "warp", "warping", "crack", "cracking", "splitting", "delamination", "corners lifting"],
    content:
      "ABS and ASA shrink as they cool. Everything that helps is about keeping the part warm and still.\n\n" +
      "• Use an **enclosed printer**. On an open A1 or P1P, large ABS parts will warp — this is physics, not a fault.\n" +
      "• Close the top glass and turn the auxiliary fan off or very low.\n" +
      "• Part cooling at 0–20%. More cooling causes layer splitting.\n" +
      "• Bed at 90–100 °C, nozzle 240–270 °C.\n" +
      "• Add a brim, and round off sharp internal corners where cracks start.\n" +
      "• Keep the printer out of a draught, and do not open the door mid-print.\n\n" +
      "Print in a ventilated room — ABS releases styrene while printing.",
  },
  {
    slug: "firmware-update",
    title: "Updating printer firmware",
    summary: "Where to find it and what to check first.",
    category: "software",
    keywords: ["firmware", "update", "updating", "version", "upgrade", "changelog", "release notes"],
    content:
      "**On the printer:** Settings → Device → Firmware → Update.\n" +
      "**In Bambu Handy or Bambu Studio:** the device page shows an update prompt when one is available.\n\n" +
      "Before updating:\n" +
      "• Make sure no print is running.\n" +
      "• Check the printer has a stable network connection — a failed download mid-update is the main way this goes wrong.\n" +
      "• Read the release notes; occasionally an update changes slicer compatibility and you need to update Bambu Studio too.\n\n" +
      "If this server has the release watcher switched on, new firmware and Bambu Studio releases are announced automatically with the changelog.",
  },
  {
    slug: "scam-warning",
    title: "Scams, fake giveaways and impersonators",
    summary: "Staff never DM first. Report impersonators with a ticket.",
    category: "safety",
    keywords: ["scam", "scammer", "phishing", "giveaway", "free printer", "impersonate", "impersonator", "dm", "hacked", "stolen"],
    content:
      "**Bambu Lab staff and this server's moderators will never:**\n" +
      "• DM you first about a prize, a giveaway or a support ticket\n" +
      "• ask for your password, your 2FA code or a crypto wallet\n" +
      "• ask for a payment to release a prize\n" +
      "• send you a login link to \"verify\" your account\n\n" +
      "**If someone DMs you claiming to be staff:** do not reply, screenshot it, block them, and open a Report a member ticket.\n\n" +
      "Check domains carefully. The only official store is `bambulab.com` — lookalike domains with extra words or a different ending are fake.",
  },
  {
    slug: "print-quality-stringing",
    title: "Stringing and blobs between parts",
    summary: "Dry the filament before touching retraction.",
    category: "printing",
    keywords: ["stringing", "strings", "wisps", "blobs", "oozing", "retraction", "hairy"],
    content:
      "**Do these in order — most people skip straight to retraction settings and never fix it.**\n\n" +
      "1. **Dry the filament.** Moisture is the cause of most stringing, especially with PETG and nylon.\n" +
      "2. **Lower the nozzle temperature** by 5–10 °C and re-test.\n" +
      "3. **Check the nozzle for a partial clog** or a worn tip.\n" +
      "4. Only then adjust retraction. Bambu profiles are well tuned; large changes usually cause new problems.\n\n" +
      "PETG strings more than PLA by nature. A small amount is normal and cleans off easily.",
  },
  {
    slug: "which-printer",
    title: "Which Bambu Lab printer should I buy?",
    summary: "Depends on whether you need an enclosure and multi-material.",
    category: "buying",
    keywords: ["which printer", "buy", "recommend", "recommendation", "best printer", "beginner", "upgrade", "compare"],
    content:
      "Run **`/printer lineup`** for the current models, or `/printer info <model>` for the details of any one.\n\n" +
      "The short version:\n" +
      "• **Just starting, small budget** — A1 mini, or the A1 for a bigger build area. Excellent for PLA and PETG.\n" +
      "• **You want ABS, ASA or carbon-fibre filaments** — you need an enclosure. P1S or P2S.\n" +
      "• **Engineering materials and unattended printing** — X-series, for the sensors and failure detection.\n" +
      "• **Large parts, production, or waste-free multi-colour** — H-series.\n\n" +
      "Multi-colour needs an AMS on any of them, except the dual-nozzle machines which handle two materials without a purge tower.",
  },
  {
    slug: "opening-a-ticket",
    title: "What to include when you open a ticket",
    summary: "The five things that get your problem solved on the first reply.",
    category: "support",
    keywords: ["ticket", "support", "help", "how to get help", "contact", "report"],
    content:
      "Support can solve most problems on the first reply if you include:\n\n" +
      "1. **Printer model and firmware version** (Settings → Device → Firmware)\n" +
      "2. **The exact error text or HMS code**, not a paraphrase\n" +
      "3. **Photos** — of the print, the part and the machine, well lit\n" +
      "4. **Slicer details** — filament type, profile, and any settings you changed\n" +
      "5. **What you already tried**\n\n" +
      "For orders, warranty and RMA, include your order number and serial number too.",
  },
  {
    slug: "makerworld-points",
    title: "MakerWorld points and model uploads",
    summary: "How points work and what gets a model rejected.",
    category: "makerworld",
    keywords: ["makerworld", "points", "upload", "model", "license", "boost", "contest", "reward"],
    content:
      "Points are earned when other people print and rate your models, and can be exchanged for store credit.\n\n" +
      "Common reasons an upload gets rejected or loses points:\n" +
      "• Re-uploading someone else's model without permission or attribution\n" +
      "• A license that does not allow redistribution\n" +
      "• Missing or misleading print profiles\n" +
      "• Renders used as \"printed\" photos\n\n" +
      "If you post a MakerWorld link in this server, the bot expands it into a preview card automatically. For account or points disputes, open an Account & Billing ticket.",
  },
];

const TAGS: { name: string; content: string; aliases: string[] }[] = [
  {
    name: "photos",
    aliases: ["photo", "pics"],
    content:
      "Could you post a few clear, well-lit photos? A shot of the whole print, a close-up of the problem area, and one of the first layer usually tells us what is going on straight away.",
  },
  {
    name: "dry",
    aliases: ["wet", "moisture"],
    content:
      "That looks like wet filament. Dry the spool before changing any settings — PLA at 55 °C for 8 hours, PETG at 65 °C, nylon at 80 °C for 12 hours. Run `/filament <material>` for the full profile.",
  },
  {
    name: "washplate",
    aliases: ["plate", "cleanplate"],
    content:
      "Wash the build plate with warm water and dish soap, then dry it with a clean towel. IPA on its own smears finger oil around instead of removing it. Handle the plate by the edges afterwards.",
  },
  {
    name: "hms",
    aliases: ["errorcode"],
    content:
      "Run `/hms <code>` with the full code (it looks like `0300-0300-0001-0001`). The bot decodes the subsystem and links the exact page on the official wiki.",
  },
  {
    name: "nodm",
    aliases: ["dmscam"],
    content:
      "Staff will never DM you first, never ask for your password or wallet, and never run giveaways over DM. If someone did, screenshot it, block them, and open a Report a member ticket.",
  },
];

const main = async () => {
  const guildId = process.argv[2];

  if (!guildId || !/^\d{5,25}$/.test(guildId)) {
    // eslint-disable-next-line no-console
    console.error("\nUsage: node packages/bot/dist/scripts/seed.js <guildId>\n");
    process.exit(1);
  }

  await prisma.guild.upsert({
    where: { id: guildId },
    create: { id: guildId, name: "Seeded server" },
    update: {},
  });

  let articles = 0;
  for (const article of ARTICLES) {
    await prisma.kbArticle.upsert({
      where: { guildId_slug: { guildId, slug: article.slug } },
      create: { ...article, guildId, createdBy: "seed" },
      update: { ...article },
    });
    articles += 1;
  }

  let tags = 0;
  for (const tag of TAGS) {
    await prisma.tag.upsert({
      where: { guildId_name: { guildId, name: tag.name } },
      create: { ...tag, guildId, createdBy: "seed" },
      update: { content: tag.content, aliases: tag.aliases },
    });
    tags += 1;
  }

  logger.info({ guildId, articles, tags }, "seed complete");
  // eslint-disable-next-line no-console
  console.log(`\nSeeded ${articles} knowledge base articles and ${tags} tags into ${guildId}.`);
  console.log("Edit or remove any of them on the dashboard under Knowledge base.\n");

  await prisma.$disconnect();
  process.exit(0);
};

void main().catch(async (err) => {
  logger.fatal({ err }, "seed failed");
  await prisma.$disconnect();
  process.exit(1);
});
