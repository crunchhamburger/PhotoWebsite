# Migration checklist: Wix → haozhewang.com on Vercel

Do the steps **in this order**. Wix stays live until the very last step, so the old site keeps working throughout.

## 1. Back up everything from Wix first

- [x] **Download all originals** from the Wix Media Manager (done: imported into `photos/`).
- [x] **Save every project's text**: title, date, location and description (done: in `photos/<slug>/index.md`).
- [ ] Note the **old URL of every project** (open each project on the live Wix site and copy the address). Six are still unknown (`project-title-1` … `6`); add redirects for them in `vercel.json`.
- [ ] Export any contact-form submissions or contacts you want to keep (Wix → Contacts / Inbox).

## 2. Domain

- [x] `haozhewang.com` is connected through Vercel.
- [ ] If any domain is **registered through Wix**, transfer it out **before** cancelling Wix: in Wix, go to **Domains → your domain → Advanced**, turn off the transfer lock and request the authorization (EPP) code, then start the transfer at the new registrar. Transfers take up to 5–7 days, and a domain registered or transferred within the last 60 days can't move yet.

## 3. Deploy and test

- [x] Push to GitHub and import the repo into Vercel (README → Deploying to Vercel).
- [x] Set up the contact form (Web3Forms; README → Contact form).
- [ ] Test on the Vercel preview URL (`https://<project>.vercel.app`):
  - [ ] Home: the hero slideshow plays, and the grid and category filters work
  - [ ] **Every project** opens, with the correct photos, text and cover
  - [ ] Lightbox: click to open, arrow keys, Esc, swipe on a phone
  - [ ] Previous/next project links
  - [ ] About page text and portrait
  - [ ] **Send a real form submission and confirm the email arrives** (check spam)
  - [ ] **On your phone:** the menu, the grid, and that nothing scrolls sideways
  - [ ] Light/dark toggle
  - [ ] **Lighthouse** (Chrome DevTools, mobile): Performance, Accessibility, Best Practices and SEO all ≥ 95

## 4. Point the domain at the new site

- [x] Vercel project → **Settings → Domains**: `www.haozhewang.com` is primary; `haozhewang.com` redirects to it.
- [ ] If the domain is currently pointed at Wix, remove the Wix DNS records and use the records (or nameservers) Vercel shows.
- [x] Verify: `https://www.haozhewang.com` loads with a valid padlock, `http://` and the bare domain redirect to it, and old Wix project URLs redirect to their new pages.

## 5. Tell Google

- [ ] In [Google Search Console](https://search.google.com/search-console), add a **Domain** property for `haozhewang.com` and verify it with a DNS TXT record (add it under Vercel → Domains → DNS records if Vercel hosts the DNS).
- [ ] Go to **Sitemaps** and submit `https://www.haozhewang.com/sitemap-index.xml`.
- [ ] Update the website link in your Instagram bio and anywhere else you've posted it.

## 6. Only then: cancel Wix

- [ ] Wait a few days and confirm that the new site works, the form emails arrive, and any domain transfer is **complete**.
- [ ] Wix → **Subscriptions**: cancel the Premium plan and **turn off auto-renew**.
- [ ] Optional: unpublish or delete the Wix site once you no longer need it as a reference.

## Cost summary

| | Before (Wix) | After |
|---|---|---|
| Hosting / site plan | ~$200/yr | **$0** (Vercel Hobby plan, for personal non-commercial sites) |
| Domain | often bundled for year 1, then ~$20–25/yr at Wix | **~$10–15/yr** |
| Contact form | included | **$0** (Formspree 50/mo or Web3Forms 250/mo free) |
| SSL, CDN, sitemap | included | **$0** (included) |
| **Total** | **~$200+/yr** | **~$10–15/yr** |
