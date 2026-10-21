import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Episode = CollectionEntry<'podcast'>;

/** All episodes, newest first (a weekly sorts after the daily of the same date). */
export async function getEpisodes(): Promise<Episode[]> {
  const episodes = await getCollection('podcast');
  return episodes.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || b.id.localeCompare(a.id));
}

/** Public URL of an episode's MP3 (the import script names it after the slug). */
export const audioPath = (ep: Episode) => `/podcast/audio/${ep.id}.mp3`;
/** Path of the MP3 on disk, relative to the project root. */
export const audioFile = (ep: Episode) => `public/podcast/audio/${ep.id}.mp3`;

/** "Tue, Oct 20, 2026". Dates are calendar days, so format in UTC. */
export function formatEpisodeDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** 219 → "3:39". */
export function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 219 → "4 min", for display next to the date. */
export function durationLabel(seconds?: number): string {
  return seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : '';
}

/** Publication time for RSS: noon UTC on the episode date, so no time zone shows it a day early. */
export function pubDate(d: Date): Date {
  return new Date(d.getTime() + 12 * 3600 * 1000);
}

/** A chart in the original reporting: caption and link only. The screenshots never reach the site. */
export type SourceChart = { file: string; caption: string; url: string };
export type Brief = { html: string; sourceCharts: SourceChart[] };

/** Where the import script puts full briefs and their source-chart captions (committed). */
export const BRIEFS_DIR = resolve('src/content/briefs');

/**
 * The full brief for an episode as HTML, with its chart list (captions and source links):
 * the published brief page (<id>.html) when the import found one, else the Markdown brief.
 */
export async function getBrief(id: string): Promise<Brief | undefined> {
  const pageFile = resolve(BRIEFS_DIR, `${id}.html`);
  const html = existsSync(pageFile)
    ? readFileSync(pageFile, 'utf8')
    : (await getEntry('briefs', id))?.rendered?.html;
  if (!html) return undefined;
  const chartsFile = resolve(BRIEFS_DIR, id, 'charts.json');
  const sourceCharts: SourceChart[] = existsSync(chartsFile) ? JSON.parse(readFileSync(chartsFile, 'utf8')) : [];
  return { html, sourceCharts };
}

/** Heading text for matching a chart's `after`: no tags, entities, numbering or case. */
export function headingKey(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;|&rsquo;|’/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Splits brief HTML so each chart lands right after the text under the h2/h3 heading that
 * matches its `after`, before the next heading of either level (so a section's own text, not
 * its subsections). Charts whose heading isn't found go at the end. Returns HTML pieces, each
 * followed by its charts.
 */
export function placeCharts<T extends { after: string }>(html: string, charts: T[]): { html: string; charts: T[] }[] {
  const heads = [...html.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({
    level: Number(m[1]),
    key: headingKey(m[2]),
    index: m.index ?? 0,
  }));
  const at = new Map<number, T[]>();
  for (const chart of charts) {
    const i = heads.findIndex((h) => h.key === headingKey(chart.after));
    const end = i < 0 ? html.length : (heads[i + 1]?.index ?? html.length);
    at.set(end, [...(at.get(end) ?? []), chart]);
  }
  const cuts = [...at.keys()].sort((a, b) => a - b);
  const out: { html: string; charts: T[] }[] = [];
  let from = 0;
  for (const cut of cuts) {
    out.push({ html: html.slice(from, cut), charts: at.get(cut)! });
    from = cut;
  }
  out.push({ html: html.slice(from), charts: [] });
  return out;
}
