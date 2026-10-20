import type { ImageMetadata } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';

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

export type Project = CollectionEntry<'projects'>;

/** Published projects in grid order. */
export async function getProjects(): Promise<Project[]> {
  const all = await getCollection('projects', ({ data }) => !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order);
}

export function projectCover(project: Project): Photo {
  const imgs = imagesIn(project.id);
  const match = imgs.find((i) => i.file === project.data.cover) ?? imgs[0];
  if (!match) throw new Error(`Project "${project.id}" has no images in photos/${project.id}/`);
  return {
    src: match.src,
    file: match.file,
    alt: project.data.coverAlt || project.data.alt[match.file] || `${project.data.title} — cover photograph`,
  };
}

/** Gallery images in filename order. The cover is excluded unless it is the only image. */
export function projectGallery(project: Project): Photo[] {
  const imgs = imagesIn(project.id);
  const gallery = imgs.length > 1 ? imgs.filter((i) => i.file !== project.data.cover) : imgs;
  return gallery.map((i, n) => ({
    src: i.src,
    file: i.file,
    // TODO alt text: add entries under `alt:` in photos/<slug>/index.md
    alt: project.data.alt[i.file] || `${project.data.title}, photograph ${n + 1}`,
  }));
}

// Optional alt text for the hero slides and portrait: photos/_home/alt.json, photos/_about/alt.json
const altFiles = import.meta.glob<Record<string, string>>('/photos/_*/alt.json', {
  eager: true,
  import: 'default',
});
const altFor = (folder: string) => altFiles[`/photos/${folder}/alt.json`] ?? {};

/** Hero slideshow images from /photos/_home. */
export function heroImages(): Photo[] {
  const alts = altFor('_home');
  return imagesIn('_home').map((i) => ({ ...i, alt: alts[i.file] ?? 'Photograph by Michael Wang' }));
}

/** First image in /photos/_about. */
export function aboutPortrait(): Photo | undefined {
  const img = imagesIn('_about')[0];
  return img && { ...img, alt: altFor('_about')[img.file] ?? 'Portrait of Michael Wang holding a camera' };
}
