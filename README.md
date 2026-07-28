# Grant Intelligence

AI-powered grant search for Early Career Researchers (ECRs) in Business and Law. Searches the live web for currently open grant opportunities and lets users filter by location, funding amount, and success rate.

**Live site:** https://ecrgrantfinder.netlify.app/

---

## How It Works

This app needs to do a real-time web search + AI synthesis, which routinely takes 10–40+ seconds. Netlify's standard (synchronous) functions get killed after ~10 seconds, so a normal "call an API, wait for the response" architecture doesn't work here. Instead, the app uses a **submit-and-poll** pattern:

```
┌─────────────┐         ┌──────────────────────────┐         ┌─────────────┐
│             │  POST   │  search-grants-background │         │             │
│  Browser    │────────▶│  (Background Function,    │         │  Anthropic  │
│  (index.    │ 202 OK  │   up to 15 min runtime)    │────────▶│  API        │
│   html)     │ (fast)  │                            │◀────────│ (web search)│
│             │         └──────────────┬─────────────┘         └─────────────┘
│             │                        │ writes result
│             │                        ▼
│             │         ┌──────────────────────────┐
│             │  GET    │   Netlify Blobs           │
│             │◀───────▶│   (key-value store,       │
│             │ poll    │    key = jobId)            │
│             │ every   └──────────────┬─────────────┘
│             │ 2s               ▲     │
│             │                  │ reads
│             │         ┌────────┴─────────────┐
└─────────────┘         │  check-grant-status   │
                         │  (regular Function)   │
                         └───────────────────────┘
```

1. **Browser** generates a random `jobId` and POSTs it (with search filters) to `search-grants-background`.
2. That's a **Netlify Background Function** — it returns `202 Accepted` almost instantly and then keeps running server-side for up to 15 minutes, well clear of any request timeout.
3. It calls the **Anthropic API** with the `web_search` tool to find current grants, then writes the result into **Netlify Blobs** (a built-in key-value store) under the `jobId`.
4. Meanwhile, the **browser polls** `check-grant-status?jobId=...` every 2 seconds — a fast, ordinary function that just checks Blobs for a result.
5. Once the status comes back `done`, the browser parses the JSON and renders the grant cards.

---

## Features

- **AI-powered search** across the live web for current Business/Law ECR grants (Australia and/or international)
- **Filters**: location, discipline (Business/Law/both), funding amount range, success rate
- **Sorting**: by closing date, amount, or success rate
- **Deadline countdown** on each grant card (colour-coded: red ≤7 days, amber ≤30 days, teal beyond)
- **Save/bookmark grants** — persists in the browser (localStorage) across searches and sessions, no login needed
- **Add to Calendar** — downloads an `.ics` file for a grant's closing date
- **Shareable search links** — filters are encoded in the URL, so sending a link reproduces the same search
- **Export to PDF** (via browser print) and **Export to CSV**
- **24-hour result caching** — repeat searches with the same location+discipline combination return instantly instead of re-running a full AI search, cutting Anthropic API costs. A "Force fresh search" checkbox bypasses the cache when needed.
- **ECU branding** — School of Business and Law logo, official brand colours (Teal `#26b298`, Plum `#b11d75`, Black, White, Ecru `#eff4f2`)

---

## File Structure

```
├── index.html                                  # Frontend (React via CDN, no build step)
├── package.json                                # Declares the @netlify/blobs dependency
└── netlify/
    └── functions/
        ├── search-grants-background.js         # Does the AI + web search work; also writes cache
        ├── check-grant-status.js               # Fast poll endpoint the frontend calls
        └── get-cached-grants.js                # Checks for a fresh (<24h) cached result before searching
```

---

## Setup

### 1. Get an Anthropic API key
https://console.anthropic.com/ → API Keys → Create key (starts with `sk-ant-...`)

### 2. Set the environment variable in Netlify
Site settings → Environment variables → Add variable:
- Key: `ANTHROPIC_API_KEY`
- Value: your key

**Important:** you must trigger a new deploy after adding/changing this — environment variables only take effect on the next build.

### 3. Deploy
Push to GitHub with the file structure above. Netlify auto-detects `netlify/functions/` and runs `npm install` (pulling in `@netlify/blobs`) as part of the build.

No `netlify.toml` is required for this setup.

---

## Key Lessons Learned (the hard way)

These are the specific gotchas that caused real debugging time — worth knowing if you're modifying this app:

- **GitHub Pages cannot run this app.** It has no backend, so it can't call the Anthropic API or run functions at all. This must be hosted on Netlify (or an equivalent platform with serverless functions).

- **Standard Netlify Functions time out too fast for this use case.** Free-tier synchronous functions get ~10 seconds; a web search + AI synthesis routinely takes longer. That's why this app uses a **Background Function** (`-background.js` filename suffix) instead — available on Netlify's free plan, runs up to 15 minutes.

- **Background Functions require `connectLambda(event)`.** Using the classic `exports.handler = async (event, context) => {...}` style (a.k.a. "Lambda compatibility mode"), Netlify Blobs is **not** automatically configured. You must call `connectLambda(event)` from `@netlify/blobs` at the very top of the handler before calling `getStore()` — otherwise every single Blobs call crashes with a generic `500 Internal Server Error`.

- **Don't use `consistency: "strong"` with Blobs in this setup.** It throws `BlobsConsistencyError: ...has not been configured with a 'uncachedEdgeURL' property` in Lambda-compatibility mode. Default (eventual) consistency is fine here since the frontend polls every 2 seconds anyway.

- **Function filenames matter exactly.** `/.netlify/functions/search-grants` maps to a file literally named `search-grants.js`. A typo or suffix (like `search-grants-FAST.js`) means the endpoint 404s even though the code is "there."

- **CORS headers must be on every response** — including error responses and the `OPTIONS` preflight handler. Missing them anywhere shows up in the browser as an opaque "Failed to fetch" / "Access not allowed."

- **Anthropic model names get retired.** If you start seeing an API error like `model: not_found_error`, it means the hardcoded model string in `search-grants-background.js` (currently `claude-haiku-4-5-20251001`) has been deprecated. Check https://docs.claude.com/en/docs/about-claude/models/overview for the current model list and swap it in.

- **The AI can legitimately find zero qualifying grants.** Grant rounds open and close throughout the year — it's normal and correct for a search to sometimes return no results. The prompt explicitly allows Claude to return an empty JSON array `[]` rather than forcing a fixed count, and the frontend shows a calm "nothing found right now" message rather than treating this as an error.

- **Caching keys only vary by location + discipline.** The amount and success-rate filters are applied client-side after the fact (the AI search itself doesn't vary by them), so the cache key is deliberately just `location:discipline` — this keeps the cache hit rate high without needing to cache every possible filter combination.

- **Claude's `web_search` tool can return `stop_reason: "pause_turn"`** on longer turns — this means the API paused mid-response and expects you to send the partial response back to continue. The background function handles this automatically (see the continuation loop), capped at 2 retries to bound total latency.

- **Netlify Blobs and browser caching can make it hard to tell if a deploy actually took effect.** When debugging, always check: (a) GitHub shows the commit landed, (b) Netlify's Deploys tab shows a recent "Published" deploy, and (c) View Page Source on the live site (not just the rendered page) to confirm the actual served HTML — in an incognito window to rule out caching.

---

## Troubleshooting Checklist

If something breaks again, check in this order:

1. **Netlify → Functions → `search-grants-background` → logs.** This is the single most useful debugging tool — it shows exactly what the function is doing, including API response status, `stop_reason`, and any errors, with timestamps.
2. **Confirm `ANTHROPIC_API_KEY` is set** in Site settings → Environment variables, and that you redeployed *after* setting it.
3. **Confirm the live site matches your latest commit** — View Page Source in incognito, search for a distinctive string you just added.
4. **Check the Anthropic model name is still valid** if you get a `not_found_error`.

---

## Cost

- **Netlify hosting + functions:** Free tier is sufficient (Background Functions are available on Free/Personal/Pro plans).
- **Anthropic API:** Pay-as-you-go, roughly a few cents per search depending on how much web searching Claude does.
