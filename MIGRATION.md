# Migration checklist: Wix → own domain + Cloudflare Pages

Do the steps **in this order**. Wix stays live until the very last step, so the old site keeps working throughout.

## 1. Back up everything from Wix first

- [ ] **Download all originals** from the Wix Media Manager. In the Wix dashboard, open **Media** (or Site → Media Manager), open each folder, select all images and click **Download**. Large selections arrive as a ZIP. Check that the files are full resolution.
- [ ] Better still, **re-export from Lightroom** if you have the catalog: JPEG, sRGB, long edge 3000–4000 px, quality ~85 (see README → Photo workflow).
- [ ] **Save every project's text**: title, date, location and description. Copy them from the live site, using the mobile view, which shows the real text.
- [ ] Note the **old URL of every project** (open each project on the live site and copy the address). You need them for the `TODO` lines in `public/_redirects` (`7-nightlapse`, `project-title-1` … `6`).
- [ ] Export any contact-form submissions or contacts you want to keep (Wix → Contacts / Inbox).

## 2. Get the domain

- [ ] **No domain yet, or a new one:** buy it at **Cloudflare Registrar** (dash.cloudflare.com → Domain Registration). It is sold at cost, about **$10–15 a year** for a `.com`, with free WHOIS privacy and DNS already set up for Pages.
- [ ] **Existing domain registered through Wix:** transfer it out **before** cancelling Wix.
  1. In Wix, go to **Domains → your domain → Advanced** and turn off the transfer lock, then **request the authorization (EPP) code**.
  2. At the new registrar (e.g. Cloudflare: add the domain to Cloudflare first, then Domain Registration → Transfer), enter the code and pay. The transfer adds a year to the registration.
  3. Approve the confirmation email. Transfers take up to 5–7 days.
  - Caveat: a domain registered or transferred **within the last 60 days** can't be transferred (ICANN lock). Wait until the 60 days are up.
  - Caveat: make sure the domain doesn't expire mid-transfer, and keep the Wix plan active until the transfer completes.
- [ ] **Domain registered elsewhere but connected to Wix:** leave it where it is for now. You'll change its DNS in step 4.

## 3. Deploy and test on the `pages.dev` URL

- [ ] Replace the placeholder photos and fill in the TODOs (README → TODO for Michael).
- [ ] Push to GitHub and deploy to Cloudflare Pages (README → Deploying).
- [ ] Set up the contact form (README → Contact form) and redeploy.
- [ ] Test on `https://<project>.pages.dev`:
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

- [ ] Pages project → **Custom domains**: add `yourdomain.com` and `www.yourdomain.com` (README → Custom domain).
- [ ] If the DNS isn't on Cloudflare, switch the nameservers to Cloudflare (recommended) or add the CNAME records.
- [ ] Set `PUBLIC_SITE_URL=https://yourdomain.com` in Pages → Settings → Variables, then **redeploy**.
- [ ] Add the `www → apex` redirect rule.
- [ ] Verify: `https://yourdomain.com` loads with a valid padlock, `http://` and `www.` redirect to it, and an old Wix project URL redirects to its new page.

## 5. Tell Google

- [ ] In [Google Search Console](https://search.google.com/search-console), add a **Domain** property and verify it with a DNS TXT record (one click if DNS is on Cloudflare).
- [ ] Go to **Sitemaps** and submit `https://yourdomain.com/sitemap-index.xml`.
- [ ] Update the website link in your Instagram bio and anywhere else you've posted it.

## 6. Only then: cancel Wix

- [ ] Wait a few days and confirm that the domain transfer is **complete** (if you did one), the new site works, and the form emails arrive.
- [ ] Wix → **Subscriptions**: cancel the Premium plan and **turn off auto-renew**. If the domain is still with Wix, turn off its auto-renew only after it has moved.
- [ ] Optional: unpublish or delete the Wix site once you no longer need it as a reference.

## Cost summary

| | Before (Wix) | After |
|---|---|---|
| Hosting / site plan | ~$200/yr | **$0** (Cloudflare Pages free tier) |
| Domain | often bundled for year 1, then ~$20–25/yr at Wix | **~$10–15/yr** (Cloudflare Registrar, at cost) |
| Contact form | included | **$0** (Formspree 50/mo or Web3Forms 250/mo free) |
| SSL, CDN, sitemap | included | **$0** (included) |
| **Total** | **~$200+/yr** | **~$10–15/yr** |
