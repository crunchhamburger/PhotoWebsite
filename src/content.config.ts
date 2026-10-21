import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { categories } from './site.config';
import seriesConfig from './data/series.json';

// One project = one folder in /photos/<slug>/ with an index.md describing it.
// The folder name is the URL slug: /projects/<slug>.
const projects = defineCollection({
  loader: glob({
    pattern: '[!_]*/index.md',
    base: './photos',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    title: z.string(),
    order: z.number(), // sort order in the grid (1 = first)
    year: z.number().optional(),
    date: z.string().optional(), // free text, e.g. "August 14th, 2025"
    location: z.string().optional(),
    type: z.string().default('Photography'),
    categories: z.array(z.enum(categories)).default([]),
    cover: z.string().default('cover.jpg'), // filename inside the folder
    coverAlt: z.string().optional(),
    // Per-image alt text, keyed by filename: { "01.jpg": "Players stretching before tip-off" }
    alt: z.record(z.string()).default({}),
    draft: z.boolean().default(false),
  }),
});

// Original charts for an episode, listed in its frontmatter by the brief pipeline. Each goes
// at the end of the brief section named in `after`. Only charts relevant to that day's news:
// there are no default charts.
const seriesIds = Object.keys(seriesConfig.series) as [string, ...string[]];
const chartSource = z.object({ publication: z.string(), title: z.string(), url: z.string().url() });
const lineChart = z.object({
  type: z.literal('line'),
  after: z.string().min(1), // heading of the brief section to place the chart under
  title: z.string().min(1),
  series: z.array(z.enum(seriesIds)).min(1).max(3), // public-domain series in src/data/series.json
  range: z.enum(['3m', '6m', '1y', '2y', '5y', '10y', 'ytd', 'max']).default('1y'),
  transform: z.enum(['level', 'yoy']).default('level'), // yoy: % change on a year earlier (monthly series)
  note: z.string().optional(),
});
// Figures from the news, drawn by us. Allowed only when an official source or two independent
// publications confirm every number; `sources` lists them under the chart.
const barChart = z
  .object({
    type: z.literal('bar'),
    after: z.string().min(1),
    title: z.string().min(1),
    unit: z.string().default(''),
    data: z.array(z.object({ label: z.string().min(1), value: z.number() })).min(2).max(12),
    verification: z.enum(['official', 'two-sources']),
    sources: z.array(chartSource).min(1),
    note: z.string().optional(),
  })
  .refine(
    (c) => c.verification === 'official' || new Set(c.sources.map((s) => s.publication.toLowerCase())).size >= 2,
    { message: 'two-sources bar charts need sources from at least two different publications' },
  );
export const chartSpec = z.discriminatedUnion('type', [lineChart, barChart.innerType()]).superRefine((c, ctx) => {
  if (c.type === 'bar') {
    const r = barChart.safeParse(c);
    if (!r.success) r.error.issues.forEach((i) => ctx.addIssue(i));
  }
});
export type ChartSpec = z.infer<typeof chartSpec>;

// Podcast episodes: copied from the market-brief pipeline by `npm run podcast:import`.
// Slug is the file name: <date> for daily, <date>-weekly for weekly. The MP3 lives at
// public/podcast/audio/<slug>.mp3; `audio` keeps the pipeline's original file name.
const podcast = defineCollection({
  loader: glob({
    pattern: '*.md',
    base: './src/content/podcast',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['daily', 'weekly']),
    headline: z.string(),
    audio: z.string().regex(/\.mp3$/i, 'audio must be an .mp3 file name'),
    duration: z.number().int().positive().optional(),
    tickers: z.array(z.string()).default([]),
    sources: z
      .array(z.object({ publication: z.string(), title: z.string(), url: z.string().url() }))
      .default([]),
    charts: z.array(chartSpec).max(4).default([]),
  }),
});

// Full market briefs shown on each episode page (copied by scripts/import-podcast.mjs).
const briefs = defineCollection({
  loader: glob({
    pattern: '*.md',
    base: './src/content/briefs',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
});

// Simplified Chinese text for a project: photos/<slug>/index.zh.md (photos and settings come from index.md).
const projectsZh = defineCollection({
  loader: glob({
    pattern: '[!_]*/index.zh.md',
    base: './photos',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    location: z.string().optional(),
    type: z.string().optional(),
  }),
});

export const collections = { projects, projectsZh, podcast, briefs };
