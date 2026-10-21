import type { APIRoute } from 'astro';

// Generated at build time so the Sitemap line uses the configured `site` (PUBLIC_SITE_URL).
// /research is the owner-only view (login required anyway); keep crawlers out of it.
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\nDisallow: /research\nDisallow: /api/\n\nSitemap: ${new URL('sitemap-index.xml', site)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
