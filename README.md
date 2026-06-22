# Bike Challenge — Cloudflare Worker (with Static Assets)

Single-family reward tracker. React frontend served as static assets by a Worker, with a KV-backed `/api/data` endpoint for syncing across devices.

## Architecture

- **Frontend**: Vite + React + Tailwind, built to `dist/` and served by the Worker via its `[assets]` binding.
- **API**: Worker fetch handler at `/api/data` (in `worker-src/index.js`).
- **Storage**: Cloudflare KV — one JSON blob.
- **Auth**: optional shared PIN via `FAMILY_PIN` env var → `X-Pin` header.

## Deploy via the dashboard (no CLI)

1. **Create a KV namespace**
   - Cloudflare dashboard → **Storage & Databases** → **KV** → **Create a namespace**
   - Name it `bike-challenge-data`
   - Copy the **Namespace ID** shown after creation
   - Open `wrangler.toml` in your repo and replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with that ID. Commit the change.

2. **Push this project to GitHub** (web UI is fine — `github.com/new`, drag the folder in)

3. **Create the Worker** via Workers & Pages → **Create** → **Import a repository** → pick your repo
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Click **Deploy**

4. **After first deploy**, in the Worker's **Settings → Variables and Secrets**:
   - Add secret `FAMILY_PIN` (any string — e.g. `dragon-flame-2026`)
   - Add plaintext variable `VITE_FAMILY_PIN` with the same value
   - Click **Save and Deploy** to retrigger a build with the env vars baked in

5. **Custom domain** (optional)
   - Worker → **Settings → Domains & Routes** → **Add → Custom domain**

That's it. Open the `*.workers.dev` URL on the device he'll use.

## Local development (only if you want it)

```bash
npm install
npm run dev      # Vite at :5173
# In another shell:
npx wrangler dev # Worker at :8787 — full stack including KV
```

## Locking it down further

`FAMILY_PIN` is a deterrent — anyone with the URL and the right PIN can hit it. For real protection, add **Cloudflare Access** in front of the Worker (Zero Trust → Access → Applications → Add → Self-hosted, pointed at your Worker URL) and restrict by email.

## Data shape

Single JSON blob under one KV key (default `bike-challenge-v1`):

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

The `parentPin` inside the blob controls the in-app parent panel. The `FAMILY_PIN` env var (separate) gates the API at the edge.

## File structure

```
.
├── worker-src/index.js       Worker entry (API + assets fallthrough)
├── public/bike.jpg           Default goal image
├── src/
│   ├── App.jsx               Main React component
│   ├── storage.js            fetch wrapper around /api/data
│   ├── main.jsx              Entry
│   └── index.css             Tailwind
├── wrangler.toml             Worker + KV + assets config
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
└── index.html
```
