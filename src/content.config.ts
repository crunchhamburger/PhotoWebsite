import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { categories } from './site.config';

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
