import { createCanvas, loadImage } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import { childLogger } from "../core/logger";
import { ensureFonts, fontStack } from "./fonts";

const log = childLogger("rank-card");

const WIDTH = 900;
const HEIGHT = 260;

export interface RankCardInput {
  displayName: string;
  avatarUrl: string;
  level: number;
  rank: number | null;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  accentColor: string;
  backgroundColor: string;
  backgroundUrl?: string;
}

const rgba = (hex: string, alpha: number): string => {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16) || 0;
  const g = Number.parseInt(clean.slice(2, 4), 16) || 0;
  const b = Number.parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const pill = (ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, w: number, h: number) => {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
};

const compact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
};

/** Renders the /level card. Returns null on any failure; the caller falls back to an embed. */
export const renderRankCard = async (input: RankCardInput): Promise<AttachmentBuilder | null> => {
  ensureFonts();
  try {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    const accent = input.accentColor || "#00AE42";
    const bg = input.backgroundColor || "#0B1120";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (input.backgroundUrl) {
      try {
        const image = await loadImage(input.backgroundUrl);
        const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
        ctx.drawImage(image, (WIDTH - image.width * scale) / 2, (HEIGHT - image.height * scale) / 2, image.width * scale, image.height * scale);
        ctx.fillStyle = rgba(bg, 0.7);
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      } catch {
        // Fall through to the flat background.
      }
    }

    // Accent glow behind the avatar.
    const glow = ctx.createRadialGradient(130, HEIGHT / 2, 10, 130, HEIGHT / 2, 200);
    glow.addColorStop(0, rgba(accent, 0.35));
    glow.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Avatar
    const size = 150;
    const cx = 130;
    const cy = HEIGHT / 2;
    try {
      const avatar = await loadImage(input.avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 + 5, 0, Math.PI * 2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();
    } catch (err) {
      log.debug({ err }, "avatar load failed");
    }

    const left = 240;

    ctx.fillStyle = "#FFFFFF";
    ctx.font = fontStack("bold", 38);
    const name = input.displayName.length > 20 ? `${input.displayName.slice(0, 19)}…` : input.displayName;
    ctx.fillText(name, left, 82);

    // Rank and level, right aligned.
    ctx.textAlign = "right";
    ctx.font = fontStack("bold", 34);
    ctx.fillStyle = accent;
    ctx.fillText(`LEVEL ${input.level}`, WIDTH - 45, 82);
    if (input.rank) {
      ctx.font = fontStack("normal", 24);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(`RANK #${input.rank}`, WIDTH - 45, 118);
    }
    ctx.textAlign = "left";

    // Progress bar
    const barX = left;
    const barY = 150;
    const barW = WIDTH - left - 45;
    const barH = 34;
    const span = Math.max(input.nextLevelXp - input.currentLevelXp, 1);
    const done = Math.min(Math.max((input.xp - input.currentLevelXp) / span, 0), 1);

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    pill(ctx, barX, barY, barW, barH);
    ctx.fill();

    if (done > 0.01) {
      const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      fill.addColorStop(0, accent);
      fill.addColorStop(1, rgba(accent, 0.65));
      ctx.fillStyle = fill;
      pill(ctx, barX, barY, Math.max(barW * done, barH), barH);
      ctx.fill();
    }

    ctx.font = fontStack("normal", 20);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(
      `${compact(input.xp - input.currentLevelXp)} / ${compact(span)} XP to level ${input.level + 1}`,
      barX,
      barY + barH + 28,
    );

    ctx.textAlign = "right";
    ctx.fillText(`${input.xp.toLocaleString("en-US")} XP total`, WIDTH - 45, barY + barH + 28);

    return new AttachmentBuilder(await canvas.encode("png"), { name: "rank.png" });
  } catch (err) {
    log.error({ err }, "rank card render failed");
    return null;
  }
};
