#!/usr/bin/env bun

import { CONFIG } from "./config.js";

// ======================
// CONFIG
// All values driven by environment variables — no hardcoded credentials
// ======================
export async function fetchOrders(runDir, logger) {
  const CLIENT_ID = process.env.OZON_CLIENT_ID;
  const API_KEY = process.env.OZON_API_KEY;

  if (!CLIENT_ID || !API_KEY) {
    throw new Error("❌ Missing OZON_CLIENT_ID or OZON_API_KEY in environment");
  }

  const ORDER_LIMIT = CONFIG.ORDER_LIMIT;
  const DAYS_BACK = CONFIG.DAYS_BACK;
  const STATUS = CONFIG.STATUS;
  const OUTPUT_FILE = `${runDir}/${CONFIG.filenames.raw}`;

  const BASE_URL = "https://api-seller.ozon.ru";
  const HEADERS = {
    "Client-Id": CLIENT_ID,
    "Api-Key": API_KEY,
    "Content-Type": "application/json",
  };

  const DATE_TO = new Date();
  const DATE_FROM = new Date(DATE_TO.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000);

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;
  const MAX_RETRY_DELAY = 30000;

  // BUG 1 FIX: distinguish fatal errors (4xx auth/client) from retryable errors (429/5xx)
  // Previously all non-ok responses returned null, making auth failures look like "no orders"
  async function apiFetch(url, body, description = "API call", { fatal = false } = {}) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      logger.debug(`${description} - Attempt ${attempt + 1}/${MAX_RETRIES}`);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        logger.debug(`${description} - Status: ${res.status}`);

        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          const wait = Math.min(RETRY_DELAY * 2 ** attempt, MAX_RETRY_DELAY);
          logger.warn(`${description} - ${res.status}, retrying in ${wait / 1000}s...`);
          await Bun.sleep(wait);
          continue;
        }

        if (!res.ok) {
          const errorText = (await res.text()).slice(0, 300);
          logger.error(`${description} - ERROR ${res.status}: ${errorText}`);

          // BUG 1 FIX: 4xx errors on the main orders fetch are fatal — throw immediately
          // so the pipeline fails loudly instead of silently returning 0 orders
          if (fatal) {
            throw new Error(`Ozon API error ${res.status}: ${errorText}`);
          }

          return null;
        }

        return res;
      } catch (err) {
        // Re-throw fatal errors immediately — don't retry auth failures
        if (err.message.startsWith("Ozon API error")) throw err;

        const wait = Math.min(RETRY_DELAY * 2 ** attempt, MAX_RETRY_DELAY);
        logger.warn(`${description} - ${err.message}, retrying in ${wait / 1000}s...`);
        await Bun.sleep(wait);
      }
    }
    logger.error(`${description} - ALL ${MAX_RETRIES} ATTEMPTS FAILED`);

    if (fatal) {
      throw new Error(`${description} failed after ${MAX_RETRIES} attempts`);
    }
    return null;
  }

  async function fetchAllPostings() {
    const postings = [];
    let cursor = "";
    const PAGE_SIZE = 100;

    logger.info(`📦 Fetching orders (status=${STATUS})...`);

    while (true) {
      // BUG 1 FIX: pass fatal:true so auth errors throw instead of returning null→0 orders
      const res = await apiFetch(
        `${BASE_URL}/v4/posting/fbs/list`,
        {
          filter: {
            since: DATE_FROM.toISOString().replace(/\.\d{3}Z$/, "Z"),
            to: DATE_TO.toISOString().replace(/\.\d{3}Z$/, "Z"),
            statuses: STATUS ? [STATUS] : undefined,
          },
          limit: PAGE_SIZE,
          cursor: cursor || undefined,
          with: { barcodes: true, financial_data: true, analytics_data: true },
        },
        `Fetch orders (batch=${postings.length})`,
        { fatal: true }
      );

      if (!res) break;

      const data = await res.json();
      const batch = data.postings ?? [];
      const hasNext = data.has_next ?? false;

      postings.push(...batch);
      process.stdout.write(`\x1b[2K\r  → ${postings.length} orders fetched...`);

      if (ORDER_LIMIT && postings.length >= ORDER_LIMIT) {
        postings.length = ORDER_LIMIT; // Truncate to exact limit
        break;
      }
      if (!hasNext || !data.cursor || batch.length === 0) break;
      cursor = data.cursor;
    }

    process.stdout.write("\n");
    logger.info(`✅ Fetched ${postings.length} orders`);
    return postings;
  }

  async function fetchProductInfo(skusByOffer) {
    const skus = Object.values(skusByOffer);
    const result = {};
    if (!skus.length) return result;

    const totalBatches = Math.ceil(skus.length / 50);
    logger.info(`🖼️  Fetching product info (${skus.length} SKUs)...`);

    let failedBatches = 0;

    for (let i = 0; i < skus.length; i += 50) {
      const batch = skus.slice(i, i + 50).map(Number).filter((n) => !isNaN(n));
      const batchNum = Math.floor(i / 50) + 1;

      process.stdout.write(`\x1b[2K\r  → batch ${batchNum}/${totalBatches}...`);

      const res = await apiFetch(`${BASE_URL}/v3/product/info/list`, { sku: batch }, `Product info batch ${batchNum}`);

      // BUG 2 FIX: track failed batches and warn — previously silent
      if (!res) {
        failedBatches++;
        continue;
      }

      const { items = [] } = await res.json();
      for (const item of items) {
        if (item.offer_id) {
          result[item.offer_id] = { product_id: item.id, primary_image: item.primary_image };
        }
      }
    }
    process.stdout.write("\n");

    if (failedBatches > 0) {
      logger.warn(`⚠️  ${failedBatches}/${totalBatches} product info batch(es) failed — some products may have missing images.`);
    }

    return result;
  }

  async function fetchDimensions(offerIds) {
    const result = {};
    if (!offerIds.length) return result;

    const totalBatches = Math.ceil(offerIds.length / 100);
    logger.info(`📐 Fetching dimensions (${offerIds.length} products)...`);

    let failedBatches = 0;

    for (let i = 0; i < offerIds.length; i += 100) {
      const batch = offerIds.slice(i, i + 100);
      const batchNum = Math.floor(i / 100) + 1;

      process.stdout.write(`\x1b[2K\r  → batch ${batchNum}/${totalBatches}...`);

      const res = await apiFetch(`${BASE_URL}/v4/product/info/attributes`, {
        filter: { offer_id: batch, visibility: "ALL" },
        limit: 100,
        sort_dir: "ASC",
      }, `Dimensions batch ${batchNum}`);

      // BUG 2 FIX: track failed batches and warn — previously silent
      if (!res) {
        failedBatches++;
        continue;
      }

      const { result: items = [] } = await res.json();
      for (const item of items) {
        if (item.offer_id) {
          result[item.offer_id] = {
            height: item.height,
            width: item.width,
            depth: item.depth,
            dimension_unit: item.dimension_unit,
            weight: item.weight,
            weight_unit: item.weight_unit,
          };
        }
      }
    }
    process.stdout.write("\n");

    if (failedBatches > 0) {
      logger.warn(`⚠️  ${failedBatches}/${totalBatches} dimension batch(es) failed — some products may have missing weight/size data in PDFs.`);
    }

    return result;
  }

  async function enrichPostings(postings) {
    const skusByOffer = {};
    for (const posting of postings) {
      for (const p of posting.products ?? []) {
        if (p.offer_id && p.sku) skusByOffer[p.offer_id] = p.sku;
      }
    }

    const offerIds = Object.keys(skusByOffer);
    if (!offerIds.length) return postings;

    const [productInfo, dimensionsMap] = await Promise.all([
      fetchProductInfo(skusByOffer),
      fetchDimensions(offerIds),
    ]);

    for (const posting of postings) {
      for (const p of posting.products ?? []) {
        if (!p.offer_id) continue;
        const info = productInfo[p.offer_id] ?? {};
        const dims = dimensionsMap[p.offer_id] ?? {};
        p.product_id = info.product_id;
        p.primary_image = info.primary_image;
        p.dimensions = dims;
      }
    }
    return postings;
  }

  const postings = await fetchAllPostings();
  if (!postings.length) {
    logger.warn("❌ No orders found.");
    return { count: 0 };
  }

  const enriched = await enrichPostings(postings);
  await Bun.write(OUTPUT_FILE, JSON.stringify(enriched, null, 2));
  logger.info(`📄 Saved raw data to ${OUTPUT_FILE}`);

  return { count: enriched.length };
}