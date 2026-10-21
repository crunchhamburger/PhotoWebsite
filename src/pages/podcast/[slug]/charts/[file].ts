import type { APIRoute, GetStaticPaths } from 'astro';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { BRIEFS_DIR } from '../../../../lib/podcast';

// Serves the brief's chart images in `npm run dev` only. They are screenshots of other
// publications' graphics, so a production build generates no files here (see showChartImages).
export const getStaticPaths = (() => {
  if (!import.meta.env.DEV || !existsSync(BRIEFS_DIR)) return [];
  return readdirSync(BRIEFS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(BRIEFS_DIR, d.name, 'charts')))
    .flatMap((d) =>
      readdirSync(join(BRIEFS_DIR, d.name, 'charts')).map((file) => ({ params: { slug: d.name, file } })),
    );
}) satisfies GetStaticPaths;

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export const GET: APIRoute = ({ params }) => {
  const path = join(BRIEFS_DIR, params.slug!, 'charts', params.file!);
  if (!import.meta.env.DEV || !existsSync(path)) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(path), {
    headers: { 'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' },
  });
};
