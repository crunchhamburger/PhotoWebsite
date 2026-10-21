// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Canonical URLs, Open Graph URLs, sitemap.xml and robots.txt use this domain.
// PUBLIC_SITE_URL overrides it (e.g. for a staging deploy).
// www is the primary host on Vercel (haozhewang.com redirects to it).
const site = process.env.PUBLIC_SITE_URL || 'https://www.haozhewang.com';

export default defineConfig({
  site,
  output: 'static',
  // One URL per page, without a trailing slash: /about, /projects/court-dreams.
  // Pages build to about.html etc., which Vercel serves at clean URLs (cleanUrls in vercel.json).
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/portfolio'),
      // English at /, Simplified Chinese at /zh: the sitemap links each page to its translation.
      i18n: { defaultLocale: 'en', locales: { en: 'en', zh: 'zh-Hans' } },
    }),
  ],
  redirects: {
    '/portfolio': '/#work',
  },
});
