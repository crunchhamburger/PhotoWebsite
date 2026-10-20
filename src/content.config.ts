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

export const collections = { projects };
