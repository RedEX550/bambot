import { ChannelType, type Collection, type Message, type TextBasedChannel } from "discord.js";
import dayjs from "dayjs";

/**
 * Renders a channel into a standalone HTML transcript.
 *
 * Everything is inlined — no external CSS, no scripts, no remote fonts — so the
 * file still opens correctly years later from a backup, and can be attached to
 * a Discord message without the recipient loading anything from us.
 */

export interface TranscriptMeta {
  guildName: string;
  channelName: string;
  ticketNumber?: number;
  category?: string;
  openerTag?: string;
  closedByTag?: string;
  closeReason?: string;
  openedAt?: Date;
  closedAt?: Date;
  messageCount: number;
  participants: string[];
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** A deliberately small markdown subset: enough to read, nothing that can inject. */
const renderContent = (raw: string): string => {
  let html = escapeHtml(raw);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code: string) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/__([^_]+)__/g, "<u>$1</u>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@user</span>');
  html = html.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#channel</span>');
  html = html.replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="mention">@role</span>');
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noreferrer noopener nofollow">$1</a>');
  return html.replace(/\n/g, "<br>");
};

const messageBlock = (message: Message): string => {
  const author = escapeHtml(message.author.displayName || message.author.username);
  const avatar = message.author.displayAvatarURL({ size: 64, extension: "png" });
  const time = dayjs(message.createdAt).format("DD MMM YYYY, HH:mm");
  const bot = message.author.bot ? '<span class="badge">BOT</span>' : "";

  const attachments = [...message.attachments.values()]
    .map((a) => {
      const name = escapeHtml(a.name);
      if (a.contentType?.startsWith("image/")) {
        return `<div class="attachment"><img src="${escapeHtml(a.url)}" alt="${name}" loading="lazy"><div class="filename">${name}</div></div>`;
      }
      return `<div class="attachment file"><a href="${escapeHtml(a.url)}" rel="noreferrer noopener">📎 ${name}</a></div>`;
    })
    .join("");

  const embeds = message.embeds
    .map((embed) => {
      const color = embed.hexColor ?? "#00AE42";
      const title = embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : "";
      const description = embed.description ? `<div class="embed-desc">${renderContent(embed.description)}</div>` : "";
      const fields = embed.fields
        .map(
          (f) =>
            `<div class="embed-field${f.inline ? " inline" : ""}"><div class="embed-field-name">${escapeHtml(
              f.name,
            )}</div><div class="embed-field-value">${renderContent(f.value)}</div></div>`,
        )
        .join("");
      const image = embed.image ? `<img class="embed-image" src="${escapeHtml(embed.image.url)}" loading="lazy">` : "";
      const footer = embed.footer ? `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>` : "";
      return `<div class="embed" style="border-left-color:${escapeHtml(color)}">${title}${description}<div class="embed-fields">${fields}</div>${image}${footer}</div>`;
    })
    .join("");

  const content = message.content ? `<div class="content">${renderContent(message.content)}</div>` : "";
  const edited = message.editedAt ? '<span class="edited">(edited)</span>' : "";

  return `<div class="message" id="m${message.id}">
  <img class="avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy">
  <div class="body">
    <div class="meta"><span class="author">${author}</span>${bot}<span class="time">${time}</span>${edited}</div>
    ${content}${embeds}${attachments}
  </div>
</div>`;
};

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b1120;color:#e2e8f0;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5}
.wrap{max-width:900px;margin:0 auto;padding:24px}
header{border-bottom:1px solid #1e293b;padding-bottom:20px;margin-bottom:24px}
h1{margin:0 0 4px;font-size:22px;color:#fff}
.sub{color:#94a3b8;font-size:13px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:18px}
.card{background:#111c33;border:1px solid #1e293b;border-radius:10px;padding:12px}
.card .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.card .value{font-size:15px;color:#f1f5f9;margin-top:4px;word-break:break-word}
.message{display:flex;gap:12px;padding:10px 8px;border-radius:8px}
.message:hover{background:#0f172a}
.avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:#1e293b}
.body{min-width:0;flex:1}
.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.author{font-weight:600;color:#fff}
.time,.edited{color:#64748b;font-size:12px}
.badge{background:#00ae42;color:#04220f;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px}
.content{margin-top:2px;word-wrap:break-word;overflow-wrap:anywhere}
code{background:#1e293b;padding:1px 5px;border-radius:4px;font-family:Consolas,monospace;font-size:13px}
pre{background:#020617;border:1px solid #1e293b;border-radius:8px;padding:12px;overflow-x:auto}
pre code{background:none;padding:0}
a{color:#38bdf8}
.mention{background:rgba(0,174,66,.18);color:#4ade80;border-radius:4px;padding:0 3px}
.embed{background:#111c33;border-left:4px solid #00ae42;border-radius:6px;padding:10px 14px;margin-top:6px;max-width:520px}
.embed-title{font-weight:600;color:#fff;margin-bottom:4px}
.embed-desc{color:#cbd5e1;font-size:14px}
.embed-fields{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.embed-field{min-width:100%}
.embed-field.inline{min-width:30%;flex:1}
.embed-field-name{font-size:12px;font-weight:700;color:#fff}
.embed-field-value{font-size:13px;color:#cbd5e1}
.embed-footer{margin-top:8px;font-size:11px;color:#64748b}
.embed-image,.attachment img{max-width:100%;border-radius:8px;margin-top:8px}
.attachment{margin-top:6px}
.attachment .filename{font-size:11px;color:#64748b}
.attachment.file a{display:inline-block;background:#111c33;border:1px solid #1e293b;border-radius:8px;padding:8px 12px;text-decoration:none}
footer{margin-top:32px;padding-top:16px;border-top:1px solid #1e293b;color:#475569;font-size:12px;text-align:center}
@media print{body{background:#fff;color:#000}.message:hover{background:none}}
`;

export const renderTranscript = (messages: Message[], meta: TranscriptMeta): string => {
  const ordered = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const body = ordered.map(messageBlock).join("\n");

  const cards = [
    meta.ticketNumber ? { label: "Ticket", value: `#${meta.ticketNumber}` } : null,
    meta.category ? { label: "Category", value: meta.category } : null,
    meta.openerTag ? { label: "Opened by", value: meta.openerTag } : null,
    meta.closedByTag ? { label: "Closed by", value: meta.closedByTag } : null,
    meta.openedAt ? { label: "Opened", value: dayjs(meta.openedAt).format("DD MMM YYYY, HH:mm") } : null,
    meta.closedAt ? { label: "Closed", value: dayjs(meta.closedAt).format("DD MMM YYYY, HH:mm") } : null,
    { label: "Messages", value: String(meta.messageCount) },
    meta.closeReason ? { label: "Reason", value: meta.closeReason } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Transcript — #${escapeHtml(meta.channelName)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>#${escapeHtml(meta.channelName)}</h1>
  <div class="sub">${escapeHtml(meta.guildName)} • transcript generated ${dayjs().format("DD MMM YYYY, HH:mm")}</div>
  <div class="summary">
    ${cards.map((c) => `<div class="card"><div class="label">${escapeHtml(c.label)}</div><div class="value">${escapeHtml(c.value)}</div></div>`).join("")}
  </div>
</header>
<main>
${body || '<p class="sub">No messages were sent in this channel.</p>'}
</main>
<footer>Generated by Bambot • ${escapeHtml(String(meta.participants.length))} participant(s)</footer>
</div>
</body>
</html>`;
};

/** Pulls the full history of a channel, oldest first, in 100-message pages. */
export const fetchAllMessages = async (channel: TextBasedChannel, limit = 5000): Promise<Message[]> => {
  if (channel.type === ChannelType.GuildStageVoice) return [];
  const all: Message[] = [];
  let before: string | undefined;

  while (all.length < limit) {
    const batch: Collection<string, Message> = await channel.messages
      .fetch({ limit: 100, before })
      .catch(() => null as never);
    if (!batch || batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return all.reverse();
};
