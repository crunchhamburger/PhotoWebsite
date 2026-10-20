// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Set PUBLIC_SITE_URL in Cloudflare Pages (or .env) once the domain is live.
// It drives canonical URLs, Open Graph URLs and sitemap.xml.
const site = process.env.PUBLIC_SITE_URL || 'https://michaelwang.example';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !page.includes('/portfolio') })],
  redirects: {
    '/portfolio': '/#work',
  },
});
