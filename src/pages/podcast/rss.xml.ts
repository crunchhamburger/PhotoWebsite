import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { podcast } from '../../site.config';
import { getEpisodes, getBrief, audioPath, audioFile, formatDuration, pubDate } from '../../lib/podcast';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET(context: APIContext) {
  const site = context.site!;
  const episodes = await getEpisodes();

  return rss({
    title: podcast.title,
    description: podcast.description,
    site: new URL('/podcast', site).href,
    // Match the site's URLs: /podcast/2026-10-20, never /podcast/2026-10-20/.
    trailingSlash: false,
    xmlns: { itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd' },
    customData: [
      `<language>${podcast.language}</language>`,
      `<itunes:author>${escape(podcast.author)}</itunes:author>`,
      `<itunes:summary>${escape(podcast.description)}</itunes:summary>`,
      `<itunes:type>episodic</itunes:type>`,
      `<itunes:explicit>false</itunes:explicit>`,
      `<itunes:category text="Business"><itunes:category text="Investing" /></itunes:category>`,
    ].join(''),
    items: await Promise.all(episodes.map(async (ep) => {
      const { title, headline, date, duration } = ep.data;
      // Show notes: the full brief when there is one, else the short episode notes.
      const notes = (await getBrief(ep.id))?.entry.rendered?.html ?? ep.rendered?.html ?? '';
      return {
        title,
        link: `/podcast/${ep.id}`,
        pubDate: pubDate(date),
        description: `${headline} ${podcast.disclaimer}`,
        content: `<p>${escape(headline)}</p>${notes}<p><em>${podcast.disclaimer}</em></p>`,
        enclosure: {
          url: new URL(audioPath(ep), site).href,
          // Run from the project root (npm run build / dev), where public/ lives.
          length: statSync(resolve(audioFile(ep))).size,
          type: 'audio/mpeg',
        },
        customData: [
          `<itunes:episodeType>full</itunes:episodeType>`,
          duration ? `<itunes:duration>${formatDuration(duration)}</itunes:duration>` : '',
        ].join(''),
      };
    })),
  });
}
