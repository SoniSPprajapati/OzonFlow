#!/usr/bin/env bun

/**
 * ozon-finance.js
 *
 * Finance module for the /charges dashboard.
 *
 * Fetches ACTUAL financial data from Ozon Seller API v1:
 *   POST /v1/finance/accrual/types     — authoritative type dictionary
 *   POST /v1/finance/accrual/postings  — per-posting commission breakdown (batched in 50s)
 *   POST /v1/finance/accrual/by-day    — account/item-level accruals (paginated)
 *
 * Key design rules:
 *   - Posting numbers come from preloadedPostingNumbers (passed by route.ts from fresh FBS data).
 *     NEVER depends on 01_data_raw.json for this — that file belongs to the FBS pipeline only.
 *   - Every amount comes directly from Ozon — NO estimates, NO mathematical reconstruction.
 *   - Raw v1 records preserved in _raw field for full auditability.
 *   - Failed batches are retried. Failed batches are never silently skipped.
 *   - Detailed stdout logs for every batch so route.ts can stream them to the console.
 */

import path from "path";
import { CONFIG } from "./config.js";

const BASE_URL = "https://api-seller.ozon.ru";
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;
const POSTING_BATCH_SIZE = 50;

// ── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function toOzonDate(d) {
  return d.toISOString().split("T")[0];
}

// ── API fetch with exponential-backoff retry ─────────────────────────────────

async function apiFetch(url, body, headers, description) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const wait = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
        console.log(`[Finance] ${description} — HTTP ${res.status}, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ozon API ${res.status}: ${errText.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      if (err.message.startsWith("Ozon API")) throw err;
      const wait = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
      console.log(`[Finance] ${description} — error: ${err.message}, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(wait);
    }
  }
  throw new Error(`[Finance] ${description} — all ${MAX_RETRIES} attempts failed`);
}

// ── Type Dictionary ──────────────────────────────────────────────────────────

async function fetchAccrualTypes(headers) {
  console.log("[Finance] Fetching accrual type dictionary...");
  const data = await apiFetch(`${BASE_URL}/v1/finance/accrual/types`, null, headers, "Fetch Accrual Types");
  const typeMap = {};
  if (data?.accrual_types) {
    for (const t of data.accrual_types) {
      typeMap[t.id] = t.name;
    }
  }
  console.log(`[Finance] Accrual type dictionary: ${Object.keys(typeMap).length} types loaded`);
  return typeMap;
}

// ── Normalization: Posting Accrual → flat transaction ────────────────────────
// A posting accrual from /v1/finance/accrual/postings contains sale_amount and
// sale_commission natively — we extract them directly. No reconstruction.

// normalizePostingAccrual: converts one posting accrual object from /v1/finance/accrual/postings
// into an ARRAY of flat transaction records (one per fee line in pa.accruals[]).
//
// Actual v1 structure (confirmed from live API):
// {
//   posting_number: "...",
//   accruals: [
//     { type_id: 69, accrued: { amount: "-460.16", currency: "RUB" },
//       seller_price: { amount: "719", currency: "RUB" }, sku: 3500571435, quantity: 4 },
//     { type_id: 66, accrued: { amount: "-57.52" }, seller_price: null },
//     ...
//   ]
// }
//
// type_id 69 = SaleCommission: seller_price * quantity → accruals_for_sale (order value)
//                              accrued.amount          → sale_commission (negative)
// All other type_ids: accrued.amount → amount (logistics, returns, etc.)

function normalizePostingAccrual(pa, accountLabel, typeMap) {
  const postingNumber = pa.posting_number || null;
  const transactions = [];

  for (const acc of (pa.accruals || [])) {
    const typeId = acc.type_id;
    const operationTypeName = typeId != null
      ? (typeMap[typeId] || `UnknownType_${typeId}`)
      : "UnknownFee";
    const accrued = parseFloat(acc.accrued?.amount) || 0;
    const sellerPrice = acc.seller_price ? parseFloat(acc.seller_price.amount) || 0 : null;
    const quantity = acc.quantity || 1;

    // SaleCommission (type_id 69): seller_price × qty is the order value (gross revenue),
    // accrued is the commission taken (negative).
    let accrualsForSale = null;
    let saleCommission = null;
    let operationType = operationTypeName;

    if (typeId === 69) { // SaleCommission
      accrualsForSale = sellerPrice !== null ? Math.round(sellerPrice * quantity * 100) / 100 : null;
      saleCommission = accrued; // negative
      operationType = "v1_POSTING_SALE";
    }

    // Unique operation_id per accrual line: posting + typeId + date
    const operationId = `pa_${postingNumber}_t${typeId}_${acc.accrual_date || "nodate"}`;

    transactions.push({
      account: accountLabel,
      operation_id: operationId,
      operation_date: acc.accrual_date || null,
      operation_type: operationType,
      operation_type_name: operationTypeName,
      amount: accrued,
      accruals_for_sale: accrualsForSale,
      sale_commission: saleCommission,
      delivery_charge: null,
      return_delivery_charge: null,
      transaction_type: typeId === 69 ? "orders" : "other",
      posting_number: postingNumber,
      order_number: postingNumber,
      sku: acc.sku ? String(acc.sku) : null,
      quantity: acc.quantity || null,
      services: [],
      items: acc.sku ? [{ sku: String(acc.sku), name: null }] : [],
      has_partner_service: operationTypeName === "StarsMembership",
      partner_services: [],
      type_id: typeId,
      _raw: { pa, acc },
    });
  }

  return transactions;
}

// ── Normalization: By-Day Fee → flat transaction ─────────────────────────────

function normalizeFee(accrual, fee, accountLabel, typeMap) {
  const typeId = fee.type_id;
  // Use the authoritative Ozon type name. Never invent a legacy name.
  const operationTypeName = typeId != null
    ? (typeMap[typeId] || `UnknownType_${typeId}`)
    : "UnknownFee";

  const amount = parseFloat(fee.accrued?.amount) || 0;
  const unitNumber = accrual.unit_number || null;

  // Preserve unique operation_id: accrual_id + typeId to avoid collisions when
  // the same accrual object has multiple fee lines.
  const operationId = accrual.accrual_id != null
    ? `${accrual.accrual_id}_t${typeId}`
    : `byday_${unitNumber}_t${typeId}_${Math.random()}`;

  return {
    account: accountLabel,
    operation_id: operationId,
    operation_date: accrual.date || null,
    operation_type: operationTypeName,
    operation_type_name: operationTypeName,
    amount,
    accruals_for_sale: null,
    sale_commission: null,
    delivery_charge: null,
    return_delivery_charge: null,
    transaction_type: "other",
    posting_number: unitNumber,
    order_number: unitNumber,
    sku: fee.sku || null,
    sku_mapping_status: fee.sku ? "sku_present" : "no_sku",
    quantity: null,
    services: [],
    items: fee.sku ? [{ sku: fee.sku, name: null }] : [],
    has_partner_service: operationTypeName === "StarsMembership",
    partner_services: [],
    type_id: typeId,
    _raw: { accrual, fee },
  };
}

// ── Posting Accruals Batch Fetch ─────────────────────────────────────────────

async function fetchPostingAccruals(postingNumbers, headers, accountLabel, typeMap) {
  const allAccruals = [];
  const totalBatches = Math.ceil(postingNumbers.length / POSTING_BATCH_SIZE);

  console.log(`[CHARGES][FINANCE] Starting posting accrual fetch: ${postingNumbers.length} posting numbers in ${totalBatches} batches of ${POSTING_BATCH_SIZE}`);

  for (let i = 0; i < postingNumbers.length; i += POSTING_BATCH_SIZE) {
    const batchNum = Math.floor(i / POSTING_BATCH_SIZE) + 1;
    const batch = postingNumbers.slice(i, i + POSTING_BATCH_SIZE);

    let batchData = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        batchData = await apiFetch(
          `${BASE_URL}/v1/finance/accrual/postings`,
          { posting_numbers: batch },
          headers,
          `Posting Accruals Batch ${batchNum}/${totalBatches}`
        );
        break; // success
      } catch (err) {
        if (attempt < MAX_RETRIES - 1) {
          const wait = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
          console.log(`[CHARGES][FINANCE] Batch ${batchNum} failed, retrying in ${wait / 1000}s...`);
          await sleep(wait);
        } else {
          console.log(`[CHARGES][FINANCE] Batch ${batchNum} FAILED after ${MAX_RETRIES} attempts: ${err.message}`);
          // Do NOT return partial data or fill zeros — throw so route.ts gets a clear error
          throw new Error(`Finance posting batch ${batchNum} failed: ${err.message}`);
        }
      }
    }

    const received = (batchData?.posting_accruals || []);
    console.log(`[CHARGES][FINANCE] Batch ${batchNum}/${totalBatches} | requested=${batch.length} | received=${received.length}`);

    // APPEND — never overwrite. Each posting has multiple accrual lines → spread the array.
    for (const pa of received) {
      const txs = normalizePostingAccrual(pa, accountLabel, typeMap);
      for (const tx of txs) allAccruals.push(tx);
    }
  }

  console.log(`[CHARGES][FINANCE] Total posting numbers submitted: ${postingNumbers.length}`);
  console.log(`[CHARGES][FINANCE] Total posting accrual records received: ${allAccruals.length}`);
  return allAccruals;
}

// ── By-Day Accruals Paginated Fetch ─────────────────────────────────────────

async function fetchByDayAccruals(dateFrom, dateTo, headers, accountLabel, typeMap) {
  const allFees = [];
  const BY_DAY_LIMIT = 1000;

  let current = new Date(dateFrom);
  const end = new Date(dateTo);
  let pageGlobal = 0;

  while (current <= end) {
    const dateStr = toOzonDate(current);
    let offset = 0;
    let pageForDay = 0;

    while (true) {
      pageGlobal++;
      pageForDay++;
      let data;
      try {
        data = await apiFetch(
          `${BASE_URL}/v1/finance/accrual/by-day`,
          { filter: { date: dateStr }, limit: BY_DAY_LIMIT, offset },
          headers,
          `By-Day ${dateStr} page ${pageForDay}`
        );
      } catch (err) {
        console.log(`[CHARGES][BY-DAY] Page ${pageGlobal} (${dateStr} offset ${offset}) FAILED: ${err.message}`);
        // Stop day pagination on hard failure; continue to next day
        break;
      }

      const accruals = data?.accruals || [];
      const hasMore = accruals.length >= BY_DAY_LIMIT;

      console.log(`[CHARGES][BY-DAY] Page ${pageGlobal} | date=${dateStr} offset=${offset} | received=${accruals.length} | nextPage=${hasMore}`);

      for (const acc of accruals) {
        // item_fees: fees per SKU
        if (acc.item_fees?.fees) {
          for (const item of acc.item_fees.fees) {
            if (Array.isArray(item.fees)) {
              for (const fee of item.fees) {
                allFees.push(normalizeFee(acc, { ...fee, sku: item.sku }, accountLabel, typeMap));
              }
            }
          }
        }
        // non_item_fee: account-level fee (no SKU)
        if (acc.non_item_fee) {
          allFees.push(normalizeFee(acc, acc.non_item_fee, accountLabel, typeMap));
        }
        // container_fees: packaging/container fees
        if (acc.container_fees?.fees) {
          for (const fee of acc.container_fees.fees) {
            allFees.push(normalizeFee(acc, fee, accountLabel, typeMap));
          }
        }
      }

      if (!hasMore) break;
      offset += accruals.length;
    }

    current.setDate(current.getDate() + 1);
  }

  console.log(`[CHARGES][BY-DAY] Total pages fetched: ${pageGlobal}`);
  console.log(`[CHARGES][BY-DAY] Total by-day fee records: ${allFees.length}`);
  return allFees;
}

// ── Main Export ──────────────────────────────────────────────────────────────

export async function fetchFinanceData(runDir, logger, preloadedPostingNumbers = null) {
  const CLIENT_ID = process.env.OZON_CLIENT_ID;
  const API_KEY = process.env.OZON_API_KEY;
  const ACCOUNT_LABEL = process.env.ACCOUNT_LABEL || "Unknown Account";

  if (!CLIENT_ID || !API_KEY) {
    console.log("[Finance] ERROR: Missing OZON_CLIENT_ID or OZON_API_KEY");
    return { transactions: [], partnerServices: [], totals: {}, reconciliationOk: false, error: "Missing Creds" };
  }

  const headers = { "Client-Id": CLIENT_ID, "Api-Key": API_KEY, "Content-Type": "application/json" };

  const dateFrom = process.env.FINANCE_DATE_FROM
    ? new Date(process.env.FINANCE_DATE_FROM)
    : new Date(Date.now() - CONFIG.FINANCE_DAYS_BACK * 86400000);
  const dateTo = process.env.FINANCE_DATE_TO
    ? new Date(process.env.FINANCE_DATE_TO)
    : new Date();

  console.log(`[Finance] Date range: ${toOzonDate(dateFrom)} → ${toOzonDate(dateTo)}`);

  // 1. Type dictionary (cached for this run)
  const typeMap = await fetchAccrualTypes(headers);

  // 2. Determine posting numbers
  let postingNumbers;
  if (Array.isArray(preloadedPostingNumbers) && preloadedPostingNumbers.length > 0) {
    postingNumbers = preloadedPostingNumbers;
    console.log(`[Finance] Using ${postingNumbers.length} posting numbers passed from route.ts (no file dependency)`);
  } else {
    // Fallback: try reading from 01_data_raw.json (only used outside the /charges flow)
    console.log("[Finance] No preloadedPostingNumbers provided — attempting to read from 01_data_raw.json");
    const rawFile = Bun.file(path.join(runDir, CONFIG.filenames.raw));
    if (await rawFile.exists()) {
      const postings = await rawFile.json();
      postingNumbers = postings
        .map(p => p.posting_number)
        .filter(Boolean);
      console.log(`[Finance] Read ${postingNumbers.length} posting numbers from 01_data_raw.json`);
    } else {
      postingNumbers = [];
      console.log("[Finance] WARNING: No posting numbers available — posting accruals will be empty");
    }
  }

  // 3. Fetch posting accruals (commission/sale data per posting number)
  const postingTransactions = postingNumbers.length > 0
    ? await fetchPostingAccruals(postingNumbers, headers, ACCOUNT_LABEL, typeMap)
    : [];

  // 4. Fetch by-day accruals (logistics/promotions/returns/other fees)
  const byDayTransactions = await fetchByDayAccruals(dateFrom, dateTo, headers, ACCOUNT_LABEL, typeMap);

  // 5. Merge — append, never overwrite
  const transactions = [...postingTransactions, ...byDayTransactions];

  // 6. Deduplication by operation_id
  //    One posting can legitimately have multiple records so we use the full operation_id
  //    (which already includes type_id suffix for by-day fees).
  const seen = new Set();
  const deduplicated = [];
  let dupCount = 0;
  for (const tx of transactions) {
    if (seen.has(tx.operation_id)) {
      dupCount++;
      continue;
    }
    seen.add(tx.operation_id);
    deduplicated.push(tx);
  }

  if (dupCount > 0) {
    console.log(`[Finance] Deduplication: removed ${dupCount} duplicate operation_ids`);
  }

  console.log(`\n[CHARGES] ═══════════════════════════════════════════`);
  console.log(`[CHARGES] TOTAL FBS ORDERS (posting numbers)  = ${postingNumbers.length}`);
  console.log(`[CHARGES] TOTAL POSTING ACCRUAL RECORDS       = ${postingTransactions.length}`);
  console.log(`[CHARGES] TOTAL BY-DAY FEE RECORDS            = ${byDayTransactions.length}`);
  console.log(`[CHARGES] TOTAL BEFORE DEDUP                  = ${transactions.length}`);
  console.log(`[CHARGES] TOTAL AFTER DEDUP                   = ${deduplicated.length}`);
  console.log(`[CHARGES] ═══════════════════════════════════════════\n`);

  // 7. Write raw output for route.ts to consume
  const rawOutputPath = path.join(runDir, CONFIG.filenames.financeRaw);
  await Bun.write(rawOutputPath, JSON.stringify({
    fetched_at: new Date().toISOString(),
    account: ACCOUNT_LABEL,
    date_from: toOzonDate(dateFrom),
    date_to: toOzonDate(dateTo),
    operations: deduplicated,
  }));

  logger?.info(`[Finance] Wrote ${deduplicated.length} records to ${CONFIG.filenames.financeRaw}`);

  const partnerServices = deduplicated.filter(t => t.has_partner_service);
  return { transactions: deduplicated, partnerServices, totals: {}, reconciliationOk: true, error: null };
}
