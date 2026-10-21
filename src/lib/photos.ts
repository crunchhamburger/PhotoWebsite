import type { ImageMetadata } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { useT, type Lang } from '../i18n';

// Every image under /photos is imported at build time so Astro can optimise it.
const files = import.meta.glob<{ default: ImageMetadata }>(
  '/photos/**/*.{jpg,jpeg,JPG,JPEG,png,PNG,webp,WEBP,avif,tif,tiff}',
  { eager: true },
);

export interface Photo {
  src: ImageMetadata;
  file: string; // filename only, e.g. "01.jpg"
  alt: string;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** All images inside /photos/<folder>/, sorted by filename. */
export function imagesIn(folder: string): { file: string; src: ImageMetadata }[] {
  const prefix = `/photos/${folder}/`;
  return Object.keys(files)
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .sort(byName)
    .map((p) => ({ file: p.slice(prefix.length), src: files[p].default }));
}

export type Project = CollectionEntry<'projects'> & {
  lang?: Lang;
  /** The Chinese text entry when `lang` is 'zh' (render this instead of the English body). */
  zh?: CollectionEntry<'projectsZh'>;
};

/** Published projects in grid order. For 'zh', title/date/location/type come from index.zh.md. */
export async function getProjects(lang: Lang = 'en'): Promise<Project[]> {
  const all = (await getCollection('projects', ({ data }) => !data.draft)).sort((a, b) => a.data.order - b.data.order);
  if (lang === 'en') return all;
  const zh = new Map((await getCollection('projectsZh')).map((e) => [e.id, e]));
  return all.map((p) => {
    const z = zh.get(p.id);
    if (!z) return { ...p, lang }; // no translation yet: fall back to the English text
    const { title, date, location, type } = z.data;
    return {
      ...p,
      lang,
      zh: z,
      data: { ...p.data, title, date: date ?? p.data.date, location: location ?? p.data.location, type: type ?? p.data.type },
    };
  });
}

/** getStaticPaths for project pages, with wrap-around previous/next projects. */
export async function projectPaths(lang: Lang) {
  const projects = await getProjects(lang);
  const n = projects.length;
  return projects.map((project, i) => ({
    params: { slug: project.id },
    props: { project, prev: projects[(i - 1 + n) % n], next: projects[(i + 1) % n] },
  }));
}

export function projectCover(project: Project): Photo {
  const t = useT(project.lang ?? 'en');
  const imgs = imagesIn(project.id);
  const match = imgs.find((i) => i.file === project.data.cover) ?? imgs[0];
  if (!match) throw new Error(`Project "${project.id}" has no images in photos/${project.id}/`);
  // Hand-written alt text is English, so the Chinese pages use the generic description.
  const custom = project.lang === 'zh' ? '' : project.data.coverAlt || project.data.alt[match.file];
  return { src: match.src, file: match.file, alt: custom || t('project.cover', { title: project.data.title }) };
}

/**
 * Gallery images in filename order. A dedicated cover file (cover.jpg etc.) is left out of the
 * gallery; if `cover:` points at a numbered photo instead, that photo stays in the gallery.
 */
export function projectGallery(project: Project): Photo[] {
  const t = useT(project.lang ?? 'en');
  const imgs = imagesIn(project.id);
  const gallery = imgs.length > 1 ? imgs.filter((i) => !/^cover\./i.test(i.file)) : imgs;
  return gallery.map((i, n) => ({
    src: i.src,
    file: i.file,
    alt: (project.lang !== 'zh' && project.data.alt[i.file]) || t('project.photo', { title: project.data.title, n: n + 1 }),
  }));
}

// Optional alt text for the hero slides and portrait: photos/_home/alt.json, photos/_about/alt.json,
// and the Chinese versions alt.zh.json next to them.
const altFiles = import.meta.glob<Record<string, string>>('/photos/_*/alt*.json', {
  eager: true,
  import: 'default',
});
const altFor = (folder: string, lang: Lang) =>
  altFiles[`/photos/${folder}/alt${lang === 'zh' ? '.zh' : ''}.json`] ?? {};

/** Hero slideshow images from /photos/_home. */
export function heroImages(lang: Lang = 'en'): Photo[] {
  const alts = altFor('_home', lang);
  const fallback = lang === 'zh' ? 'Michael Wang 的摄影作品' : 'Photograph by Michael Wang';
  return imagesIn('_home').map((i) => ({ ...i, alt: alts[i.file] ?? fallback }));
}

/** First image in /photos/_about. */
export function aboutPortrait(lang: Lang = 'en'): Photo | undefined {
  const img = imagesIn('_about')[0];
  const fallback = lang === 'zh' ? 'Michael Wang 手持相机的肖像' : 'Portrait of Michael Wang holding a camera';
  return img && { ...img, alt: altFor('_about', lang)[img.file] ?? fallback };
}
