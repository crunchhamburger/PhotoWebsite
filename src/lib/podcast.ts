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

export type Chart = { file: string; caption: string; url: string };
export type PrivateBrief = { entry: CollectionEntry<'briefs'>; charts: Chart[] };

/** Where the import script puts full briefs and charts (git-ignored). */
export const BRIEFS_DIR = resolve('src/content/briefs');

/**
 * The full brief and charts for an episode, for the local preview. Always undefined in a
 * production build, so paywalled text and third-party charts never reach dist/.
 */
export async function getPrivateBrief(id: string): Promise<PrivateBrief | undefined> {
  if (!import.meta.env.DEV) return undefined;
  const entry = await getEntry('briefs', id);
  if (!entry) return undefined;
  const chartsFile = resolve(BRIEFS_DIR, id, 'charts.json');
  const charts: Chart[] = existsSync(chartsFile) ? JSON.parse(readFileSync(chartsFile, 'utf8')) : [];
  return { entry, charts };
}
