import type { KbArticle } from "@prisma/client";
import { prisma } from "../core/db";

/**
 * Knowledge base search.
 *
 * Deliberately not full-text-indexed: a community KB is a few hundred rows, and
 * a scored in-memory match is both faster to operate and much easier to tune
 * than tsvector config. If this ever grows past a few thousand articles, swap
 * `loadArticles` for a Postgres full-text query — nothing else changes.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of", "in", "on", "at", "for", "with", "and",
  "or", "but", "if", "my", "me", "i", "it", "its", "this", "that", "how", "do", "does", "did", "can", "you", "your",
  "please", "help", "any", "some", "there", "when", "what", "why", "not", "no", "so", "just", "get", "got", "have",
]);

const tokenise = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

export interface ScoredArticle {
  article: KbArticle;
  score: number;
  /** 0-100, comparable to the auto-answer confidence threshold. */
  confidence: number;
}

const cache = new Map<string, { articles: KbArticle[]; expires: number }>();

const loadArticles = async (guildId: string): Promise<KbArticle[]> => {
  const hit = cache.get(guildId);
  if (hit && hit.expires > Date.now()) return hit.articles;

  const articles = await prisma.kbArticle.findMany({ where: { guildId, published: true } });
  cache.set(guildId, { articles, expires: Date.now() + 120_000 });
  return articles;
};

export const invalidateKbCache = (guildId?: string) => {
  if (guildId) cache.delete(guildId);
  else cache.clear();
};

/**
 * Scores each article against the query.
 *
 * Weights: an exact keyword hit is the strongest signal because keywords are
 * curated by staff; title words next; body matches are weakest because a long
 * article mentions many things in passing.
 */
export const searchKb = async (guildId: string, query: string, limit = 5): Promise<ScoredArticle[]> => {
  const articles = await loadArticles(guildId);
  if (!articles.length) return [];

  const tokens = tokenise(query);
  if (!tokens.length) return [];

  const lowerQuery = query.toLowerCase();
  const results: ScoredArticle[] = [];

  for (const article of articles) {
    let score = 0;
    const title = article.title.toLowerCase();
    const summary = article.summary.toLowerCase();
    const content = article.content.toLowerCase();
    const keywords = article.keywords.map((k) => k.toLowerCase());

    if (title === lowerQuery || article.slug === lowerQuery) score += 40;
    if (keywords.includes(lowerQuery)) score += 30;

    let matchedTokens = 0;
    for (const token of tokens) {
      let matched = false;
      if (keywords.some((k) => k === token || k.includes(token))) {
        score += 8;
        matched = true;
      }
      if (title.includes(token)) {
        score += 6;
        matched = true;
      }
      if (summary.includes(token)) {
        score += 3;
        matched = true;
      }
      if (content.includes(token)) {
        score += 1;
        matched = true;
      }
      if (matched) matchedTokens += 1;
    }

    if (!score) continue;

    // Reward articles that matched most of what was asked, not just one word.
    const coverage = matchedTokens / tokens.length;
    score *= 0.5 + coverage;

    results.push({
      article,
      score,
      confidence: Math.min(100, Math.round(score * coverage * 2.2)),
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
};

export const getArticle = async (guildId: string, slug: string) =>
  prisma.kbArticle.findUnique({ where: { guildId_slug: { guildId, slug } } });

export const recordView = async (id: string) => {
  await prisma.kbArticle.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => undefined);
};

/** Slugifies a title for use as an article key. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "article";
