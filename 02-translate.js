#!/usr/bin/env bun

import { CONFIG } from "./config.js";
import path from "path";

/**
 * 02-translate.js
 *
 * Translates every Russian string in the JSON data to English, preserving
 * the entire data structure exactly. Non-Russian strings are never touched.
 *
 * Uses the undocumented Google Chrome Dictionary extension endpoint:
 *   https://clients5.google.com/translate_a/t?client=dict-chrome-ex
 *
 * This endpoint is more lenient with rate limits than the standard
 * translate_a/single endpoint used by most open-source wrappers.
 * No API key. No npm package. Pure fetch.
 *
 * Also maintains a persistent translation cache file (translate-cache.json)
 * in the project root. Strings seen in previous runs are never re-translated,
 * which means Google Translate is barely hit after the first few runs.
 */

const CACHE_FILE = path.join(process.cwd(), "translate-cache.json");

// ─── Persistent cache helpers ─────────────────────────────────────────────────

async function loadPersistentCache() {
  const file = Bun.file(CACHE_FILE);
  if (!(await file.exists())) return new Map();
  try {
    const obj = await file.json();
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

async function savePersistentCache(cache) {
  const obj = Object.fromEntries(cache);
  await Bun.write(CACHE_FILE, JSON.stringify(obj, null, 2));
}

// ─── Google clients5 endpoint ─────────────────────────────────────────────────

async function translateString(text, logger, attempts = 3) {
  try {
    const url = new URL("https://clients5.google.com/translate_a/t");
    url.searchParams.set("client", "dict-chrome-ex");
    url.searchParams.set("sl", "ru");
    url.searchParams.set("tl", "en");
    url.searchParams.set("q", text);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://chrome.google.com/",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) {
      // Hard rate limit — back off longer before retrying
      const wait = 5000 * (4 - attempts); // 5s, 10s, 15s
      logger.warn(`⚠️  Rate limited (429). Waiting ${wait / 1000}s before retry...`);
      await Bun.sleep(wait);
      throw new Error("429 rate limited");
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // sl=ru returns a flat string array of translated sentences/segments.
    // We join them to get the complete translated string.
    const translated = Array.isArray(data) ? data.join("") : null;

    if (!translated || typeof translated !== "string") {
      throw new Error(`Unexpected response: ${JSON.stringify(data).slice(0, 100)}`);
    }

    return translated;
  } catch (err) {
    if (attempts > 1) {
      await Bun.sleep(1000);
      return translateString(text, logger, attempts - 1);
    }
    // All retries exhausted — return null so we don't cache the failure
    logger.warn(`⚠️  Could not translate: "${text.substring(0, 50)}..."`);
    return null;
  }
}

// ─── JSON tree helpers ────────────────────────────────────────────────────────

const hasRussian = (str) => typeof str === "string" && /[а-яА-ЯёЁ]/.test(str);

function collectAllRussianStrings(obj, seen = new Set()) {
  if (hasRussian(obj)) {
    seen.add(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) collectAllRussianStrings(item, seen);
  } else if (obj && typeof obj === "object") {
    for (const value of Object.values(obj)) collectAllRussianStrings(value, seen);
  }
  return seen;
}

function applyTranslations(obj, cache) {
  if (hasRussian(obj)) return cache.get(obj) ?? obj;
  if (Array.isArray(obj)) return obj.map((item) => applyTranslations(item, cache));
  if (obj && typeof obj === "object") {
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      newObj[key] = applyTranslations(value, cache);
    }
    return newObj;
  }
  return obj;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function translateOrders(runDir, logger) {
  const inputFile = `${runDir}/${CONFIG.filenames.raw}`;
  const outputFile = `${runDir}/${CONFIG.filenames.translated}`;

  const CONCURRENCY = 20;   // parallel requests per batch
  const DELAY_MS = 50; // pause between batches (ms)

  // 1. Load input
  const inputBunFile = Bun.file(inputFile);
  if (!(await inputBunFile.exists())) {
    throw new Error(`Input file not found: ${inputFile}`);
  }
  const data = await inputBunFile.json();

  // 2. Collect all unique Russian strings from the entire JSON tree
  const allRussianStrings = [...collectAllRussianStrings(data)];

  if (allRussianStrings.length === 0) {
    logger.info("✅ No Russian text found. Copying input to output as-is.");
    await Bun.write(outputFile, JSON.stringify(data, null, 2));
    return;
  }

  logger.info(`🔍 Found ${allRussianStrings.length} unique Russian string(s) in data.`);

  // 3. Load persistent cache — strings translated in previous runs are free
  const persistentCache = await loadPersistentCache();
  const cacheHits = allRussianStrings.filter((s) => persistentCache.has(s));
  const cacheMisses = allRussianStrings.filter((s) => !persistentCache.has(s));

  logger.info(`📦 Cache: ${cacheHits.length} hit(s), ${cacheMisses.length} need translation.`);

  // 4. Translate only what the cache doesn't already know
  if (cacheMisses.length > 0) {
    logger.info(`🌐 Translating ${cacheMisses.length} string(s) via Google (clients5 endpoint)...`);

    for (let i = 0; i < cacheMisses.length; i += CONCURRENCY) {
      const batch = cacheMisses.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((s) => translateString(s, logger)));

      batch.forEach((original, idx) => {
        if (results[idx] !== null) {
          persistentCache.set(original, results[idx]);
        }
      });

      const progress = Math.min(i + CONCURRENCY, cacheMisses.length);
      process.stdout.write(
        `\x1b[2K\r   Progress: ${progress}/${cacheMisses.length} translated...`
      );

      if (i + CONCURRENCY < cacheMisses.length) await Bun.sleep(DELAY_MS);
    }

    process.stdout.write("\n");

    // Save updated cache back to disk for future runs
    await savePersistentCache(persistentCache);
    logger.info(`💾 Cache saved to ${CACHE_FILE} (${persistentCache.size} total entries).`);
  }

  // 5. Apply all translations (cache covers everything now)
  const translatedData = applyTranslations(data, persistentCache);
  await Bun.write(outputFile, JSON.stringify(translatedData, null, 2));
  logger.info(`✅ Translated data saved to: ${outputFile}`);
}