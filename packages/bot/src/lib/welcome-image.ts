import { createCanvas, loadImage, type SKRSContext2D, type Image } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import type { WelcomeConfig } from "@bambot/shared";
import { childLogger } from "./../core/logger";
import { ensureFonts, fontStack } from "./fonts";

const log = childLogger("welcome-image");

const WIDTH = 1000;
const HEIGHT = 350;

export interface WelcomeImageInput {
  title: string;
  subtitle: string;
  avatarUrl: string;
  config: WelcomeConfig["image"];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16) || 0,
    Number.parseInt(clean.slice(2, 4), 16) || 0,
    Number.parseInt(clean.slice(4, 6), 16) || 0,
  ];
};

const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Shrinks the font until the text fits the available width. */
const fitText = (ctx: SKRSContext2D, text: string, maxWidth: number, startSize: number, weight = "bold"): number => {
  let size = startSize;
  ctx.font = fontStack(weight, size);
  while (ctx.measureText(text).width > maxWidth && size > 12) {
    size -= 2;
    ctx.font = fontStack(weight, size);
  }
  return size;
};

const roundedRectPath = (ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

/** The technical grid that gives the blueprint template its look. */
const drawGrid = (ctx: SKRSContext2D, accent: string) => {
  ctx.save();
  ctx.strokeStyle = rgba(accent, 0.1);
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 25) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 25) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(WIDTH, y + 0.5);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(accent, 0.22);
  for (let x = 0; x <= WIDTH; x += 125) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 125) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(WIDTH, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
};

const drawAvatar = (ctx: SKRSContext2D, image: Image, cx: number, cy: number, size: number, shape: string, accent: string) => {
  const half = size / 2;
  ctx.save();

  // Accent ring
  ctx.beginPath();
  if (shape === "circle") ctx.arc(cx, cy, half + 6, 0, Math.PI * 2);
  else roundedRectPath(ctx, cx - half - 6, cy - half - 6, size + 12, size + 12, shape === "rounded" ? 28 : 0);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.beginPath();
  if (shape === "circle") ctx.arc(cx, cy, half, 0, Math.PI * 2);
  else roundedRectPath(ctx, cx - half, cy - half, size, size, shape === "rounded" ? 22 : 0);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, cx - half, cy - half, size, size);
  ctx.restore();
};

/**
 * Renders the welcome banner.
 *
 * Fonts are whatever the host has; the stack falls back to DejaVu Sans, which
 * ships with most Linux images, so a VPS render still looks right. Any failure
 * returns null and the caller simply sends the message without an image —
 * a broken banner must never block a welcome.
 */
export const renderWelcomeBuffer = async (input: WelcomeImageInput): Promise<Buffer | null> => {
  ensureFonts();
  try {
    const cfg = input.config;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    const accent = cfg.accentColor || "#00AE42";
    const bg = cfg.backgroundColor || "#0B1120";
    const text = cfg.textColor || "#FFFFFF";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (cfg.backgroundUrl) {
      try {
        const bgImage = await loadImage(cfg.backgroundUrl);
        const scale = Math.max(WIDTH / bgImage.width, HEIGHT / bgImage.height);
        const w = bgImage.width * scale;
        const h = bgImage.height * scale;
        ctx.drawImage(bgImage, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
        ctx.fillStyle = rgba(bg, cfg.template === "classic" ? 0.72 : 0.55);
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      } catch (err) {
        log.debug({ err, url: cfg.backgroundUrl }, "background image could not be loaded");
      }
    }

    if (cfg.template === "blueprint" && cfg.showGrid) drawGrid(ctx, accent);

    if (cfg.template === "spotlight") {
      const gradient = ctx.createRadialGradient(250, HEIGHT / 2, 20, 250, HEIGHT / 2, 420);
      gradient.addColorStop(0, rgba(accent, 0.45));
      gradient.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    if (cfg.template !== "minimal") {
      ctx.strokeStyle = rgba(accent, 0.6);
      ctx.lineWidth = 2;
      roundedRectPath(ctx, 14, 14, WIDTH - 28, HEIGHT - 28, 18);
      ctx.stroke();
    }

    // Accent bar along the bottom.
    const bar = ctx.createLinearGradient(0, 0, WIDTH, 0);
    bar.addColorStop(0, accent);
    bar.addColorStop(1, rgba(accent, 0.15));
    ctx.fillStyle = bar;
    ctx.fillRect(0, HEIGHT - 8, WIDTH, 8);

    const hasAvatar = cfg.showAvatar && Boolean(input.avatarUrl);
    const avatarSize = 170;
    const avatarCx = 180;
    const textLeft = hasAvatar ? 310 : 70;
    const textWidth = WIDTH - textLeft - 70;

    if (hasAvatar) {
      try {
        const avatar = await loadImage(input.avatarUrl);
        drawAvatar(ctx, avatar, avatarCx, HEIGHT / 2 - 4, avatarSize, cfg.avatarShape, accent);
      } catch (err) {
        log.debug({ err }, "avatar could not be loaded");
      }
    }

    ctx.textBaseline = "alphabetic";

    const titleSize = fitText(ctx, input.title, textWidth, 54);
    ctx.fillStyle = text;
    ctx.font = fontStack("bold", titleSize);
    ctx.fillText(input.title, textLeft, HEIGHT / 2 + 2);

    if (input.subtitle) {
      const subSize = fitText(ctx, input.subtitle, textWidth, 26, "normal");
      ctx.font = fontStack("normal", subSize);
      ctx.fillStyle = rgba(text, 0.72);
      ctx.fillText(input.subtitle, textLeft, HEIGHT / 2 + 44);
    }

    // Small accent rule under the headline.
    ctx.fillStyle = accent;
    ctx.fillRect(textLeft, HEIGHT / 2 + 18, 64, 4);

    return await canvas.encode("png");
  } catch (err) {
    log.error({ err }, "welcome image render failed");
    return null;
  }
};

export const renderWelcomeImage = async (input: WelcomeImageInput): Promise<AttachmentBuilder | null> => {
  const buffer = await renderWelcomeBuffer(input);
  return buffer ? new AttachmentBuilder(buffer, { name: "welcome.png" }) : null;
};
