import { existsSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { childLogger } from "../core/logger";

const log = childLogger("fonts");

/**
 * Font registration for the image renderers.
 *
 * Minimal container images — including the Node images most game panels use —
 * ship with no fonts at all. Canvas does not fail in that case, it just draws
 * nothing, so a welcome banner silently comes out blank.
 *
 * DejaVu is therefore a real dependency (`dejavu-fonts-ttf`) rather than
 * something the host is expected to provide. It covers Latin, Greek, Cyrillic
 * and a wide range of symbols, which matters for a community this international.
 *
 * Anything dropped into `assets/fonts/` is registered too and takes precedence,
 * so a brand font can be used without touching code.
 */

export const FONT_FAMILY = "Bambot Sans";

/** Font stack used by every canvas renderer. */
export const fontStack = (weight: string, size: number): string =>
  `${weight} ${size}px "${FONT_FAMILY}", "DejaVu Sans", "Segoe UI", sans-serif`;

let initialised = false;

const registerBundled = (): number => {
  let count = 0;
  try {
    // Resolve through the package manifest so this works regardless of where
    // the dependency was hoisted to in the workspace.
    const ttfDir = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");

    const faces: [string, string][] = [
      ["DejaVuSans.ttf", FONT_FAMILY],
      ["DejaVuSans-Bold.ttf", FONT_FAMILY],
      ["DejaVuSans-Oblique.ttf", FONT_FAMILY],
    ];

    for (const [file, alias] of faces) {
      const path = join(ttfDir, file);
      if (!existsSync(path)) continue;
      if (GlobalFonts.registerFromPath(path, alias)) count += 1;
    }
  } catch (err) {
    log.warn({ err }, "bundled fonts could not be registered");
  }
  return count;
};

const registerCustom = (): number => {
  let count = 0;
  // Two candidates so it works both from source (ts-node) and from dist.
  const candidates = [join(process.cwd(), "assets", "fonts"), join(__dirname, "..", "..", "..", "..", "assets", "fonts")];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (![".ttf", ".otf", ".ttc"].includes(extname(file).toLowerCase())) continue;
        // Registered under the same alias so custom faces override the bundled
        // ones for the same weight.
        if (GlobalFonts.registerFromPath(join(dir, file), FONT_FAMILY)) count += 1;
      }
    } catch (err) {
      log.debug({ err, dir }, "could not read the custom font directory");
    }
    break;
  }
  return count;
};

/** Call once at startup, before anything renders an image. */
export const ensureFonts = (): void => {
  if (initialised) return;
  initialised = true;

  const bundled = registerBundled();
  const custom = registerCustom();

  if (bundled + custom === 0) {
    log.error(
      "No fonts could be registered — welcome banners and rank cards will render without text. " +
        "Reinstall dependencies, or drop a .ttf into assets/fonts/.",
    );
    return;
  }

  log.info({ bundled, custom, families: GlobalFonts.families.length }, "fonts registered");
};
