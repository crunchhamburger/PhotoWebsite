// Site-wide settings. Edit these values instead of hunting through components.
export const site = {
  name: 'Michael Wang',
  tagline: 'Portfolio',
  description:
    'Michael Wang — street, documentary and portrait photography from New York, Tokyo and beyond. Raw, cinematic, intentional.',
  email: 'michael.wang8111@gmail.com',
  // Phone is kept in config so it can be hidden without touching markup.
  phone: '929-317-9404',
  showPhone: true, // set to false to hide the phone number in the footer
  instagram: 'https://www.instagram.com/michael_whz/',
  copyrightYear: new Date().getFullYear(),
  // Contact form endpoint (Formspree / Web3Forms). Set PUBLIC_FORM_ENDPOINT in
  // Vercel → Settings → Environment Variables, or in a local .env file.
  formEndpoint: import.meta.env.PUBLIC_FORM_ENDPOINT || '',
  // Web3Forms access key (public by design; it is sent with every form submission).
  // PUBLIC_FORM_ACCESS_KEY overrides it. Submissions go to michael.wang8111@gmail.com.
  formAccessKey: import.meta.env.PUBLIC_FORM_ACCESS_KEY || '62281e8b-5e6f-44f3-b45b-2b17bcebdd64',
};

// Category filters shown above the grid. Each project's `categories` must use these values.
export const categories = ['Street', 'Events', 'Portraits', 'Travel', 'Food'] as const;
export type Category = (typeof categories)[number];

export const nav = [
  { label: 'Home', href: '/' },
  { label: 'Portfolio', href: '/#work' },
  { label: 'About Me', href: '/about' },
];
