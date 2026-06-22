# Bike Challenge — Cloudflare Pages deployment

Single-family reward tracker. React frontend on Pages, KV-backed state via a Pages Function. Same stack you already use.

## Stack

- **Frontend**: Vite + React + Tailwind (built to `dist/`)
- **API**: Pages Function at `/api/data` (in `functions/api/data.js`)
- **Storage**: Cloudflare KV — one JSON blob under key `bike-challenge-v1`
- **Auth**: optional shared PIN via `FAMILY_PIN` env var → `X-Pin` header

## First-time setup

```bash
# 1. Install deps
npm install

# 2. Log in
npx wrangler login

# 3. Create the KV namespace
npx wrangler kv namespace create bike-challenge-data
# Copy the `id` value from the output into wrangler.toml under [[kv_namespaces]]

# 4. (Optional) preview namespace for `wrangler pages dev`
npx wrangler kv namespace create bike-challenge-data --preview
# Add `preview_id = "..."` to wrangler.toml
```

## Local development

Two terminals — Vite for the frontend, Wrangler for the Function:

```bash
# Terminal 1 — Vite dev server (port 5173)
npm run dev

# Terminal 2 — Pages Functions + KV
npx wrangler pages dev --kv DATA -- npm run preview
```

Vite proxies `/api/*` to wrangler (configured in `vite.config.js`), so `http://localhost:5173` Just Works.

For a simpler local flow, you can also build once and run wrangler against `dist/`:

```bash
npm run build
npx wrangler pages dev dist --kv DATA
# visit http://localhost:8788
```

## Deploy

```bash
npm run deploy
# = npm run build && wrangler pages deploy dist
```

First deploy creates the Pages project. Subsequent deploys push to the same project.

Once deployed:

1. Cloudflare dashboard → Workers & Pages → your project → **Settings → Variables and Secrets**
2. Bind the KV namespace **DATA** to the namespace you created (Production env)
3. Add a secret **FAMILY_PIN** (any string — the frontend must send the same value)
4. Add a build-time env var **VITE_FAMILY_PIN** with the same value (Pages will rebuild on next deploy, or trigger a redeploy now)

Or set everything in `wrangler.toml` and `.env.local` and let `npm run deploy` handle it.

## Custom domain

Dashboard → your Pages project → **Custom domains → Set up a custom domain**. CNAME or change-the-NS depending on whether the domain is on Cloudflare already.

## Locking it down properly

`FAMILY_PIN` is a deterrent, not real auth — anyone with the URL can guess. For real protection use **Cloudflare Access** (Zero Trust → Access → Applications → Add → Self-hosted, pointed at your Pages URL). Free tier covers up to 50 users. Restrict to your email or your son's device's email and you're done.

## Data shape

Everything is stored as a single JSON blob under one KV key (default `bike-challenge-v1`). Schema:

```js
{
  config: { parentPin, kidName, parentName },
  tasks: [{ id, name, points, type, icon, parentOnly }],
  pending: [{ id, taskId, taskName, points, requestedAt }],
  history: [{ id, type, taskName, points, at }],
  completedToday: ["taskId", ...],
  lastResetDate: "YYYY-MM-DD",
  goal: { name, imageUrl, thresholdPct, startDate, endDate, earnedPoints }
}
```

The parent PIN inside `config` controls in-app access to the parent panel. The `FAMILY_PIN` env var (separate thing) gates the API.

## Replacing the bike image

Drop a new file into `public/bike.jpg` (or change the path), or paste a URL in **Settings → Christmas goal → Image URL** in the app.

## File structure

```
.
├── functions/api/data.js     Pages Function (KV read/write)
├── public/bike.jpg           Default goal image
├── src/
│   ├── App.jsx               Main React component
│   ├── storage.js            fetch wrapper around /api/data
│   ├── main.jsx              Entry
│   └── index.css             Tailwind
├── wrangler.toml             KV binding config
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── index.html
```
