# Ozon Order Fulfillment Pipeline

Automated 5-stage pipeline for Frostrek LLP. Fetches orders from Ozon.ru, translates Russian to English, generates PDF invoices, exports an Excel shipment report, and delivers everything to Telegram — all in a single command.

```
bun run main.js
```

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Multi-Account Setup](#multi-account-setup)
- [Running the Pipeline](#running-the-pipeline)
- [Output Structure](#output-structure)
- [Architecture](#architecture)
  - [Stage 1 — Fetch & Enrich](#stage-1--fetch--enrich)
  - [Stage 2 — Translate](#stage-2--translate)
  - [Stage 3 — Generate PDFs](#stage-3--generate-pdfs)
  - [Stage 4 — Excel Export](#stage-4--excel-export)
  - [Stage 5 — Telegram Notify](#stage-5--telegram-notify)
- [Translation Cache](#translation-cache)
- [Pricing Logic](#pricing-logic)
- [Scheduling — Cloudflare Worker](#scheduling--cloudflare-worker)
- [GitHub Actions](#github-actions)
- [Stress Testing](#stress-testing)
- [Maintenance](#maintenance)
- [Dependencies](#dependencies)

---

## Prerequisites

- [Bun](https://bun.sh/) runtime
- Ozon Seller API credentials (`Client-Id` and `Api-Key`) for each account
- A Telegram bot token + recipient chat IDs
- A Cloudflare account (for scheduling)

---

## Installation

```bash
bun install
```

---

## Configuration

For local runs, create a `.env` file in the project root:

```env
# Ozon API — required
OZON_CLIENT_ID="your_client_id"
OZON_API_KEY="your_api_key"

# Pipeline behaviour — all optional
STATUS="awaiting_packaging"   # Order status to fetch (default: awaiting_packaging)
DAYS_BACK=30                  # How far back to look in days (default: 30)
ORDER_LIMIT=null              # Cap order count — null means fetch all

# Telegram delivery — optional, notifications are silently skipped if absent
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_ALLOWED_CHAT_IDS="123456789,987654321"   # comma-separated, no spaces
ACCOUNT_LABEL="Account Name"  # Shown in Telegram messages to identify the account
```

> In GitHub Actions, all of the above are stored as **Repository Secrets** — never in the `.env` file which stays local only.

---

## Multi-Account Setup

The pipeline supports multiple Ozon accounts running in parallel, each with its own credentials, Telegram recipients, and account label. This is managed via three separate GitHub Actions workflow files and a Cloudflare Worker that triggers all of them simultaneously.

### How notifications are routed

Each account has a dedicated set of recipients plus a shared admin group that receives all accounts:

| Role | Receives |
|------|----------|
| Account employee | Their account only |
| Admin | All accounts |

The `TELEGRAM_ALLOWED_CHAT_IDS` for each workflow is constructed as:
```
"${{ secrets.TELEGRAM_CHAT_IDS_X }},${{ secrets.TELEGRAM_CHAT_IDS_ADMINS }}"
```

### GitHub Secrets required

| Secret | Description |
|--------|-------------|
| `OZON_CLIENT_ID_A` | Ozon Client ID for Account A |
| `OZON_API_KEY_A` | Ozon API Key for Account A |
| `OZON_CLIENT_ID_B` | Ozon Client ID for Account B |
| `OZON_API_KEY_B` | Ozon API Key for Account B |
| `OZON_CLIENT_ID_C` | Ozon Client ID for Account C |
| `OZON_API_KEY_C` | Ozon API Key for Account C |
| `TELEGRAM_BOT_TOKEN` | Shared bot token — same bot serves all accounts |
| `TELEGRAM_CHAT_IDS_A` | Comma-separated chat IDs for Account A recipients |
| `TELEGRAM_CHAT_IDS_B` | Comma-separated chat IDs for Account B recipients |
| `TELEGRAM_CHAT_IDS_C` | Comma-separated chat IDs for Account C recipients |
| `TELEGRAM_CHAT_IDS_ADMINS` | Comma-separated chat IDs for admins (receive all accounts) |
| `ACCOUNT_LABEL_A` | Display name shown in Telegram messages for Account A |
| `ACCOUNT_LABEL_B` | Display name shown in Telegram messages for Account B |
| `ACCOUNT_LABEL_C` | Display name shown in Telegram messages for Account C |

> **Important:** Ozon API keys are full UUIDs in the format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. Always copy them directly from the Ozon Seller dashboard — truncated keys will cause an immediate 400 error.

---

## Running the Pipeline

```bash
# Full run — all 5 stages
bun run main.js

# Wipe all previous run output
bun run clean
```

---

## Output Structure

Every execution creates a new isolated folder under `runs/` named with a timestamp. Nothing is ever overwritten.

```
runs/YYYY-MM-DD_HH-mm_run/
├── 01_data_raw.json          ← Raw enriched data direct from Ozon API
├── 02_data_translated.json   ← Same structure, all Cyrillic replaced with English
├── 03_report.xlsx            ← Excel shipment sheet (Frostrek LLP format)
├── final.pdf                 ← All invoices merged into one PDF
├── pipeline.log              ← Full JSON-structured execution audit trail
├── run-meta.json             ← Machine-readable summary (orders, duration, rate, status)
└── render/                   ← Individual per-order PDFs
    ├── 92814023-0589-1.pdf
    └── ...
```

A `translate-cache.json` is also maintained in the project root across runs — see [Translation Cache](#translation-cache).

---

## Architecture

### Stage 1 — Fetch & Enrich

**File:** `01-fetch-orders.js`

Fetches all FBS (Fulfilled by Seller) orders matching `STATUS` and the configured date range from the Ozon Seller API, then enriches each order with product data not present in the initial response.

**Fetching**
- Calls `/v3/posting/fbs/list`, paginating 50 orders at a time via `has_next`.
- Truncates to `ORDER_LIMIT` if set.
- Date range computed dynamically from `DAYS_BACK` on every run.

**Enrichment**

The raw order list contains no product images or physical dimensions. Two secondary API calls run in parallel after fetching:

| API | Data retrieved | Batch size |
|-----|---------------|------------|
| `/v3/product/info/list` | `primary_image`, `product_id` | 50 |
| `/v4/product/info/attributes` | `height`, `width`, `depth`, `weight`, units | 100 |

Results are merged back into each product object. Nothing is removed — output is a strict superset of the raw API response.

**Resilience:** All calls go through a shared retry wrapper — exponential backoff (2s → 4s → 8s, capped at 30s), 3 attempts, handles 429 and 5xx. A failed batch is skipped rather than crashing the run.

**Output:** `01_data_raw.json`

---

### Stage 2 — Translate

**File:** `02-translate.js`

Translates every Russian string in the JSON to English. Non-Russian content (IDs, SKUs, numbers, already-English text) is never touched.

**Detection:** Regex `/[а-яА-ЯёЁ]/` — any string containing Cyrillic is queued, everything else passes through.

**Endpoint:** Uses the undocumented Google Chrome Dictionary extension endpoint — no API key, no paid plan, no npm package:

```
GET https://clients5.google.com/translate_a/t
    ?client=dict-chrome-ex
    &sl=ru
    &tl=en
    &q=<encoded text>
```

Response format: `["Translated text"]` — `data[0]` is the result.

This endpoint is used internally by Google's own Chrome extension, making it significantly more rate-limit tolerant than the `translate_a/single` endpoint used by most open-source wrappers. Confirmed stable under sustained load via the included stress test.

**Batching:** Strings are translated in batches of 5 with a 200ms pause between batches. All 5 requests within a batch fire simultaneously via `Promise.all`.

**Deduplication:** The entire JSON tree is walked once to collect unique Russian strings into a `Set`. The same string appearing across multiple orders is translated exactly once.

**Retry:** Each string gets 3 attempts. A 429 triggers progressive backoff (5s / 10s / 15s). On total failure the original Russian is kept, a warning is logged, and the pipeline continues.

**Edge case:** If zero Cyrillic characters are found anywhere, the input is copied to the output path as-is — Stages 3 and 4 always get a valid input file.

**Output:** `02_data_translated.json`

---

### Stage 3 — Generate PDFs

**File:** `03-generate.js`
**Template:** `template.html`

Renders a PDF invoice for each order using an HTML template, then merges all PDFs into a single file.

**Template:** `template.html` is the master invoice blueprint. All visual changes belong there. Compiled via [Handlebars](https://handlebarsjs.com/) with custom helpers:

| Helper | Purpose |
|--------|---------|
| `formatDate` | ISO timestamp → `"22 Feb 2026"` |
| `formatWeight` | Normalises g or kg → `"0.060 kg"` |
| `totalWeight` | Sums weight across all products in an order |
| `findById` | Looks up a product by `product_id` in an array |
| `eq`, `gt` | Comparison helpers for template conditionals |

**Multi-product orders:** All products within a single order render correctly inside one invoice. Financial data is reconciled to the product list via SKU mapping before rendering.

**Rendering:** Each order's HTML goes to a headless Chromium instance via `puppeteer-core` + `@sparticuz/chromium`. The page waits for all `<img>` elements to finish loading before capture — no broken placeholders. A4 format, 10mm margins.

**Concurrency:** 5 orders render simultaneously in parallel browser tabs. For large batches this substantially cuts total render time.

**Merging:** All PDFs are stitched in original API response order into `final.pdf` using `pdf-lib`. Individual files are kept in `render/`.

**Output:** `render/*.pdf` + `final.pdf`

---

### Stage 4 — Excel Export

**File:** `04-excel.js`

Produces a formatted `.xlsx` file matching Frostrek LLP's internal shipment reporting convention.

**Columns:**

| Column | Source |
|--------|--------|
| SHIPMENT NUMBER | `posting_number` |
| Customer's full name | `customer.name` |
| Delivery address | `customer.address.address_tail` |
| Pick-up point code | `customer.address.pvz_code` (blank if 0 or absent) |
| Delivery cluster | `financial_data.cluster_to` |
| PRODUCT | All `products[].name` joined with `, ` |
| PRICE (INR) | Calculated — see [Pricing Logic](#pricing-logic) |
| Comment | Intentionally blank — reserved for manual use |

**Formatting:** Calibri 11pt throughout. Header row is bold with yellow fill (`#FFD965`). All data cells top-aligned. Column widths fixed to company template.

**Returns:** `{ rate: usdToInr }` — the live exchange rate used, consumed by `main.js` for `run-meta.json`.

**Output:** `03_report.xlsx`

---

### Stage 5 — Telegram Notify

**File:** `05-notify.js`

Delivers results to a whitelist of Telegram users after a successful run, or sends a failure alert if the pipeline crashes.

**On success:** Sends a summary message (including the account label) then uploads `final.pdf` and `03_report.xlsx` directly to each recipient as Telegram documents — no cloud storage middleman.

**On failure:** Sends an error alert with the account label, exception message, and a pointer to GitHub Actions logs for the full stack trace.

**Account label:** The `ACCOUNT_LABEL` env var is shown in every message — critical for admins who receive notifications from all three accounts simultaneously.

**Whitelist:** Only chat IDs listed in `TELEGRAM_ALLOWED_CHAT_IDS` receive anything. Per-recipient failures (e.g. bot blocked) are logged as warnings and never crash the pipeline.

**Setup:**
1. Message `@BotFather` on Telegram → `/newbot` → copy the token
2. Each recipient sends any message to the bot (one time)
3. Get chat IDs from: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Add token and IDs to `.env` or GitHub Secrets

---

## Translation Cache

`translate-cache.json` lives in the project root and persists across every run.

```json
{
  "Москва": "Moscow",
  "Карелия": "Karelia",
  "ожидает упаковки": "awaiting packaging"
}
```

Before any network request, Stage 2 checks this file. Strings translated in any previous run are served from disk instantly — Google is never called for them again. With a stable product catalogue, after the first week the translator makes almost no outbound requests.

The cache is preserved between GitHub Actions runs via `actions/cache`. Each account has its own isolated cache key so they never interfere with each other.

**If the cache gets corrupted** (e.g. a failed run stored Russian→Russian entries), delete it and the next run rebuilds it cleanly:

```bash
rm translate-cache.json
```

---

## Pricing Logic

`PRICE (INR)` is a **Frostrek service fee**, not the order total. Calculated from the order's total USD value:

| Order Total (USD) | Fee (USD) |
|-------------------|-----------|
| ≥ $30.00 | $7.70 |
| ≥ $25.00 | $6.60 |
| ≥ $20.00 | $5.50 |
| ≥ $15.00 | $4.40 |
| ≥ $5.00 | $3.30 |
| < $5.00 | $3.30 |

The USD fee is converted to INR using a live rate fetched at runtime:

1. `https://latest.currency-api.pages.dev/v1/currencies/usd.json`
2. `https://api.exchangerate-api.com/v4/latest/USD` (fallback)
3. ₹84 hardcoded (last resort)

The rate used is always logged and written to `run-meta.json`. Final INR values are rounded to the nearest integer.

---

## Scheduling — Cloudflare Worker

The pipeline is triggered by a **Cloudflare Worker** on a cron schedule. GitHub Actions' native cron was dropped due to unreliable execution timing.

**How it works:**

The Worker fires a `repository_dispatch` event to GitHub for each account simultaneously via `Promise.all`. GitHub Actions picks up each event and runs the corresponding workflow in parallel.

```javascript
// cloudflare-worker.js (simplified)
const accounts = ["run_account_a", "run_account_b", "run_account_c"];
await Promise.all(accounts.map(event_type =>
  fetch("https://api.github.com/repos/<owner>/pipeline/dispatches", {
    method: "POST",
    body: JSON.stringify({ event_type })
  })
));
```

**Cron schedules (set in Cloudflare Worker triggers):**

| Time (IST) | Cron (UTC) | Days |
|---|---|---|
| 10:30 AM | `0 5 * * SUN-FRI` | Mon–Sat IST |
| 2:35 AM | `5 21 * * SUN-FRI` | Mon–Sat IST |

> All Cloudflare cron times are in UTC. Because 10:30 AM IST crosses midnight UTC (IST = UTC+5:30), Mon–Sat IST maps to Sun–Fri UTC, hence `SUN-FRI`.

**Sunday skip:** The Worker checks if it's Sunday in IST before dispatching and exits silently if so.

**Cloudflare Worker env variable required:**

| Variable | Value |
|----------|-------|
| `GITHUB_PAT` | A GitHub Personal Access Token with `repo` scope |

**Manual trigger:** Actions tab → select a workflow → **Run workflow** button. Works independently of the Cloudflare schedule.

---

## GitHub Actions

Three workflow files handle the three accounts independently:

| File | Triggered by | Account |
|------|-------------|---------|
| `pipeline-a.yml` | `run_account_a` | Account A |
| `pipeline-b.yml` | `run_account_b` | Account B |
| `pipeline-c.yml` | `run_account_c` | Account C |

Each workflow is identical in structure — only the secrets and event type differ. All three run on `ubuntu-latest` concurrently with no shared state.

**Artifacts:** Each run uploads the entire `runs/` folder as a GitHub artifact, retained for 7 days. Download from Actions → your run → Artifacts section.

**Chromium on Actions:** The workflow installs required system libraries (`libgbm1`, `libnss3`, etc.) before running. If PDF generation ever fails in CI, this step is the first thing to check.

**`DAYS_BACK` in CI:** All workflows set `DAYS_BACK=7`.

---

## Stress Testing

```bash
chmod +x stress-test-translate.sh
./stress-test-translate.sh
```

Four tests in escalating aggression:

| Test | What it does |
|------|-------------|
| Baseline | 1 request — confirms endpoint is alive |
| Rapid fire | 10 real Russian strings, sequential, zero delay |
| Parallel burst | Same 10 strings fired simultaneously |
| Sustained abuse | 50 back-to-back requests, no delay |

Verdict at the end tells you whether the endpoint is production-safe, shows minor rate limiting (handled by retry logic), or shows heavy rate limiting (consider a proxy layer).

---

## Maintenance

| Task | Where |
|------|-------|
| Invoice layout | `template.html` |
| Pricing brackets | `PRICE_BRACKETS` in `04-excel.js` |
| Order status / date range | `.env` or `config.js` |
| Shared filename constants | `config.js` |
| Failed run diagnosis | `runs/<timestamp>/pipeline.log` |
| Machine-readable run summary | `runs/<timestamp>/run-meta.json` |
| Corrupted translation cache | `rm translate-cache.json` |
| Clean all run output | `bun run clean` |
| Add/remove Telegram recipients | Update `TELEGRAM_CHAT_IDS_*` secrets in GitHub |
| Add a new Ozon account | New workflow YAML + 3 secrets + one line in Cloudflare Worker |
| Change schedule | Update cron trigger in Cloudflare Worker dashboard |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@sparticuz/chromium` | Headless Chromium binary (serverless/CI compatible) |
| `exceljs` | Excel file generation |
| `handlebars` | HTML invoice templating |
| `pdf-lib` | PDF merging |
| `pino` + `pino-pretty` | Structured dual-output logging (console + file) |
| `puppeteer-core` | Headless browser control for PDF rendering |

**No translation package.** Stage 2 uses a direct `fetch` call to `clients5.google.com` — zero dependencies for translation.

**Runtime: Bun.** Uses `Bun.file`, `Bun.write`, and `Bun.sleep` throughout. Not compatible with Node.js without modifications.