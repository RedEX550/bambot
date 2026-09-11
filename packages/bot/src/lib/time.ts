const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  mo: 2_592_000_000,
  month: 2_592_000_000,
  months: 2_592_000_000,
  y: 31_536_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000,
};

/**
 * Parses durations the way people actually type them into Discord:
 * "7d", "1h30m", "2 weeks", "90". A bare number is read as minutes.
 * Returns milliseconds, or null when nothing could be parsed.
 */
export const parseDuration = (input: string): number | null => {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) * 60_000;

  const matches = text.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g);
  let total = 0;
  let found = false;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = UNITS[match[2]];
    if (!unit || Number.isNaN(amount)) continue;
    total += amount * unit;
    found = true;
  }
  return found ? Math.round(total) : null;
};

/** "1 day, 3 hours" — at most two units, which is all anyone reads. */
export const formatDuration = (ms: number): string => {
  if (ms <= 0) return "0 seconds";
  const parts: string[] = [];
  const steps: [string, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  let remaining = ms;
  for (const [name, size] of steps) {
    if (remaining < size) continue;
    const count = Math.floor(remaining / size);
    remaining -= count * size;
    parts.push(`${count} ${name}${count === 1 ? "" : "s"}`);
    if (parts.length === 2) break;
  }
  return parts.join(", ") || "less than a second";
};

/** Discord renders these client-side in the reader's own timezone. */
export const timestamp = (date: Date | number, style: "t" | "T" | "d" | "D" | "f" | "F" | "R" = "f"): string => {
  const seconds = Math.floor((date instanceof Date ? date.getTime() : date) / 1000);
  return `<t:${seconds}:${style}>`;
};

export const MAX_TIMEOUT_MS = 28 * 86_400_000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
