// Site-wide settings. Edit these values instead of hunting through components.
export const site = {
  name: 'Michael Wang',
  tagline: 'Portfolio',
  description:
    'Michael Wang — street, documentary and portrait photography from New York, Tokyo and beyond. Raw, cinematic, intentional.',
  email: 'michael.wang8111@gmail.com',
  // Phone is kept in config so it can be hidden without touching markup.
  phone: '929-317-9404',
  showPhone: false, // TODO: set to true if you want the phone number public.
  // TODO: confirm your Instagram handle (watermark suggests "michael_whz").
  instagram: 'https://www.instagram.com/michael_whz/',
  copyrightYear: new Date().getFullYear(),
  // Contact form endpoint (Formspree / Web3Forms). Set PUBLIC_FORM_ENDPOINT in
  // Cloudflare Pages → Settings → Environment variables, or in a local .env file.
  formEndpoint: import.meta.env.PUBLIC_FORM_ENDPOINT || '',
  // Web3Forms needs an access key instead of a unique URL; leave empty for Formspree.
  formAccessKey: import.meta.env.PUBLIC_FORM_ACCESS_KEY || '',
};

// Category filters shown above the grid. Each project's `categories` must use these values.
export const categories = ['Street', 'Events', 'Portraits', 'Travel', 'Food'] as const;
export type Category = (typeof categories)[number];

export const nav = [
  { label: 'Home', href: '/' },
  { label: 'Portfolio', href: '/#work' },
  { label: 'About Me', href: '/about' },
];
