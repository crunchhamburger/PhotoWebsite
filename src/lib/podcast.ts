import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Lang } from '../i18n';

export type Episode = CollectionEntry<'podcast'>;

/** All episodes, newest first (a weekly sorts after the daily of the same date). */
export async function getEpisodes(): Promise<Episode[]> {
  const episodes = await getCollection('podcast');
  return episodes.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || b.id.localeCompare(a.id));
}

/** Whether an episode has a Chinese edition (Chinese audio plus the Chinese brief or headline). */
export const hasZh = (ep: Episode) => Boolean(ep.data.audio_zh);

/** Public URL of an episode's MP3 (the import script names it after the slug; Chinese: <slug>.zh.mp3).
 *  Chinese pages fall back to the English audio when an episode has no Chinese edition. */
export const audioPath = (ep: Episode, lang: Lang = 'en') =>
  lang === 'zh' && hasZh(ep) ? `/podcast/audio/${ep.id}.zh.mp3` : `/podcast/audio/${ep.id}.mp3`;
/** Path of the MP3 on disk, relative to the project root. */
export const audioFile = (ep: Episode) => `public/podcast/audio/${ep.id}.mp3`;

/** Title, headline and duration in the page's language, falling back to English. */
export function episodeText(ep: Episode, lang: Lang) {
  const d = ep.data;
  const zh = lang === 'zh' && hasZh(ep);
  return {
    title: (zh && d.title_zh) || d.title,
    headline: (lang === 'zh' && d.headline_zh) || d.headline,
    duration: zh ? (d.duration_zh ?? d.duration) : d.duration,
  };
}

/** Episode URL in the page's language. */
export const episodeHref = (ep: Episode | { id: string }, lang: Lang) => `${lang === 'zh' ? '/zh' : ''}/podcast/${ep.id}`;

/** "Tue, Oct 20, 2026" / "2026年10月20日（周二）". Dates are calendar days, so format in UTC. */
export function formatEpisodeDate(d: Date, lang: Lang = 'en'): string {
  if (lang === 'zh') {
    const wd = '日一二三四五六'[d.getUTCDay()];
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（周${wd}）`;
  }
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

/** 219 → "4 min" / "4 分钟", for display next to the date. */
export function durationLabel(seconds?: number, lang: Lang = 'en'): string {
  if (!seconds) return '';
  const n = Math.max(1, Math.round(seconds / 60));
  return lang === 'zh' ? `${n} 分钟` : `${n} min`;
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
export async function getBrief(id: string, lang: Lang = 'en'): Promise<Brief | undefined> {
  // Chinese: the Chinese brief page (<id>.zh.html) only; no Markdown fallback.
  if (lang === 'zh') {
    const zhFile = resolve(BRIEFS_DIR, `${id}.zh.html`);
    if (!existsSync(zhFile)) return undefined;
    const zhCharts = resolve(BRIEFS_DIR, id, 'charts.zh.json');
    const enCharts = resolve(BRIEFS_DIR, id, 'charts.json');
    const file = existsSync(zhCharts) ? zhCharts : enCharts;
    const sourceCharts: SourceChart[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    return { html: readFileSync(zhFile, 'utf8'), sourceCharts };
  }
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

/** English brief section headings → the Chinese edition's (HANDOFF-bilingual §7.2), for placing charts. */
const ZH_HEADINGS: Record<string, string> = {
  'article takeaways': '文章要点',
  'the through-line': '主线',
  'numbers worth remembering': '关键数字',
  'top takeaways': '核心结论',
  'meaningful percentage moves': '重要涨跌幅',
  'the week in one paragraph': '本周一段话',
  'market scoreboard': '市场记分牌',
  'macro: inflation, rates, the fed': '宏观：通胀、利率与美联储',
  'ai and tech': 'AI与科技',
  'global and political': '全球与政治',
  'what to watch next week': '下周关注',
  'why it matters for you: ib interview talking points': '对你的意义：投行面试谈资',
};

/** A chart spec as shown in `lang`: Chinese title, note and section heading when there are any. */
export function localizeChart<T extends { after: string; title: string; note?: string; title_zh?: string; after_zh?: string; note_zh?: string }>(
  c: T,
  lang: Lang,
): T {
  if (lang !== 'zh') return c;
  const after = c.after_zh ?? ZH_HEADINGS[headingKey(c.after)] ?? c.after;
  return { ...c, after, title: c.title_zh ?? c.title, note: c.note_zh ?? c.note };
}

/** The Chinese narrations of an episode, in display order: the main voice and an optional second one. */
export function zhVoices(ep: Episode): { name: string; src: string; duration?: number }[] {
  const d = ep.data;
  if (!hasZh(ep)) return [];
  const voices = [{ name: d.voice_zh ?? '中文', src: `/podcast/audio/${ep.id}.zh.mp3`, duration: d.duration_zh }];
  if (d.audio_zh_2) voices.push({ name: d.voice_zh_2 ?? '第二配音', src: `/podcast/audio/${ep.id}.zh-2.mp3`, duration: d.duration_zh_2 });
  return voices;
}
