# SurfFlow — Option B Deployment Guide
## surfcam.stluker.com

---

## What you're deploying

| Piece | What it is | Cost |
|---|---|---|
| `public/index.html` | Frontend — Cloudflare Pages | Free |
| `worker/index.js` | Scoring engine — Cloudflare Worker (cron every 15 min) | Free |
| `wrangler.toml` | Worker config | — |
| Cloudflare KV | Edge cache for the scored JSON feed | Free |
| YouTube Data API | Finds currently-live surf cam streams | Free (10K req/day) |
| Open-Meteo Marine | Wave forecasts for 12 global spots | Free, no key needed |

**Estimated monthly cost: $0–2** (domain you already own)

---

## Step 1 — Get a free YouTube Data API key (5 minutes)

1. Go to https://console.cloud.google.com
2. Create a new project (name it "surfflow" or anything)
3. Search for "YouTube Data API v3" → Enable it
4. Go to Credentials → Create Credentials → API Key
5. Copy the key — you'll need it in Step 4

> **Free quota:** 10,000 units/day. Each search costs ~100 units.
> 4 searches × 96 cron runs/day = ~38,400 units. You'll want to
> restrict to 2 search queries in production, or apply for a quota increase
> (free, takes 1 day). Alternatively, set `YOUTUBE_API_KEY` to empty and
> the Worker falls back gracefully to the curated registry.

---

## Step 2 — Set up your GitHub repo

```bash
mkdir surfcam && cd surfcam
git init

# Copy these files in:
# public/index.html
# worker/index.js
# wrangler.toml

git add .
git commit -m "initial surfflow deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/surfcam.git
git push -u origin main
```

---

## Step 3 — Deploy the frontend to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages**
2. Connect your GitHub account → select the `surfcam` repo
3. Set build configuration:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
4. Click **Save and Deploy** — takes ~30 seconds

5. Add custom domain:
   - Pages project → **Custom domains** → **Set up a domain**
   - Enter: `surfcam.stluker.com`
   - Since stluker.com is already on Cloudflare, the CNAME is **auto-created**
   - Wait ~2 minutes for SSL to provision

Your site is now live at **https://surfcam.stluker.com**

---

## Step 4 — Deploy the Cloudflare Worker

### 4a — Install Wrangler (one-time)
```bash
npm install -g wrangler
wrangler login    # opens browser → authorize with your Cloudflare account
```

### 4b — Get your Cloudflare Account ID
Cloudflare dashboard → top right → your profile → Account ID (copy it)
Paste it into `wrangler.toml` where it says `YOUR_CLOUDFLARE_ACCOUNT_ID`

### 4c — Create the KV namespace
```bash
npx wrangler kv:namespace create "SURF_KV"
```
Copy the `id` it returns and paste into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "SURF_KV"
id      = "PASTE_ID_HERE"
```

### 4d — Deploy the Worker
```bash
npx wrangler deploy
```

### 4e — Set your YouTube API key as a secret
```bash
npx wrangler secret put YOUTUBE_API_KEY
# Paste your key when prompted — it's stored encrypted, never in code
```

---

## Step 5 — Verify everything works

```bash
# Check the API is responding
curl https://surfcam.stluker.com/api/health

# Should return:
# {"ok":true,"lastGenerated":"2024-...","camCount":20,"liveCount":3}

# Trigger a manual refresh (forces the Worker to run immediately)
curl https://surfcam.stluker.com/api/refresh

# Then visit the site
open https://surfcam.stluker.com
```

---

## Step 6 — Send your dad the link

Text him: **surfcam.stluker.com**

He taps it → Chrome opens → best live surf cams in the world, ranked by
current wave conditions, right now. No app, no install, no login.

---

## How the system stays itself

| What breaks | What happens |
|---|---|
| YouTube stream goes offline | Worker detects it (not embeddable = skipped), never appears in feed |
| YouTube live ID changes | YouTube Data API search finds the new ID automatically next cron run |
| Open-Meteo API is slow | CF edge caches last response, Worker uses it with no delay |
| KV cache expires (20 min) | Next browser request triggers a fresh Worker fetch on-demand |
| YouTube API quota exceeded | Worker falls back to curated registry — site still works, just no live search |

**Zero admin required after initial setup.**

---

## Future upgrades (optional)

- **Add more curated spots:** Edit `CURATED_CAMS` array in `worker/index.js`, push to GitHub, CF auto-deploys
- **Change rotation speed:** Edit `AUTO_SECS` in `public/index.html`
- **Add user favorites:** Add Cloudflare D1 (SQLite at edge, free tier) for persistent storage
- **Custom scoring weights:** Tune `computeScore()` in the Worker to prefer your local breaks

---

## File structure reference

```
surfcam/
├── public/
│   └── index.html          ← Frontend (Cloudflare Pages serves this)
├── worker/
│   └── index.js            ← Scoring Worker (cron + API endpoint)
└── wrangler.toml           ← Worker config
```
