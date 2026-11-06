#!/usr/bin/env bun
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const BASE_URL = "https://api-seller.ozon.ru";
const MAX_RETRIES = 5;
const BASE_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Category mapping table (editable, at top of order-charges.js)
// ─────────────────────────────────────────────────────────────────────────────
/*
  This mapping is a best-effort default based on common Ozon operation names —
  cross-check against discovery.json output for this account and adjust entries
  here if the dashboard totals (Sales/Returns/Referral fee/Delivery/Partner/Promotion/
  Other services/Other accruals) don't reconcile against Ozon Seller → Finance → Accruals
  for the same period.

  Keys are the exact operation_type OR services[].name strings seen in discovery.json.
  "Ozon referral fee" is always sourced from sale_commission — no entry needed here.
*/
const CATEGORY_MAP = {
  // ── Sales ────────────────────────────────────────────────────────────────
  "OperationAgentDeliveredToCustomer": "Sales",
  // Russian service names that can appear inside services[] for sale operations
  "Доставка покупателю": "Sales",

  // ── Returns ───────────────────────────────────────────────────────────────
  "ClientReturnAgentOperation": "Returns",
  "ReturnAgentOperation": "Returns",
  "OperationReturnGoodsFBSofRMS": "Returns",

  // ── Delivery services ────────────────────────────────────────────────────
  // Classic FBS per-item delivery services
  "MarketplaceServiceItemDelivToCustomer": "Delivery services",
  "MarketplaceServiceItemDropoffPVZ": "Delivery services",
  "MarketplaceServiceItemDropoffFF": "Delivery services",
  "MarketplaceServiceItemDirectFlowTrans": "Delivery services",
  "MarketplaceServiceItemReturnFlowTrans": "Delivery services",
  // Cross-border / 3PL rebill seen in live data
  "MarketplaceRedistributionOfDeliveryServicesOperation": "Delivery services",
  "OperationMarketplaceAgencyFeeAggregator3PLGlobal": "Delivery services",
  // Russian service name variants (services[].name)
  "Перевыставление услуг доставки": "Delivery services",
  "Агентское вознаграждение за заключение и сопровождение договора транспортно-экспедиционных услуг по организации международной перевозки": "Delivery services",

  // ── Partner services ─────────────────────────────────────────────────────
  "MarketplaceServiceItemFulfillment": "Partner services",
  "MarketplaceServiceItemPickup": "Partner services",
  "StarsMembership": "Partner services",
  "ItemAgentServiceStarsMembership": "Partner services",
  "Звёздные товары": "Partner services",

  // ── Promotion and advertising ────────────────────────────────────────────
  "MarketplaceMarketingActionCostOperation": "Promotion and advertising",
  "MarketplaceSellerReviewsPaidPromotionOperation": "Promotion and advertising",
  "OperationMarketplaceAcceleratedProductReviews": "Promotion and advertising",
  "MarketplaceServiceBrandCommission": "Promotion and advertising",
  // Russian service name variants
  "Ускоренный сбор отзывов": "Promotion and advertising",
  "Продвижение бренда": "Promotion and advertising",

  // ── Other services and penalties ─────────────────────────────────────────
  "MarketplaceServiceItemDefectiveWriteoff": "Other services and penalties",
  "MarketplaceSellerCompensationOperation": "Other services and penalties",
  "DefectFineCancellation": "Other services and penalties",
  "OperationSubscriptionPremium": "Other services and penalties",
  // Acquiring fee rebill
  "MarketplaceRedistributionOfAcquiringOperation": "Other services and penalties",
  // Russian service name variants
  "Превышение индекса ошибок: отмена": "Other services and penalties",
  "Оплата эквайринга": "Other services and penalties",
  "Подписка Premium": "Other services and penalties",

  // ── Other accruals ───────────────────────────────────────────────────────
  // Mutual-settlement corrections (inventory reconciliation) → Other accruals
  "OperationCorrectionSeller": "Other accruals",
  "Инвентаризация взаиморасчетов": "Other accruals",
};

const CATEGORIES = [
  "Sales", 
  "Returns", 
  "Ozon referral fee", 
  "Delivery services",
  "Partner services", 
  "Promotion and advertising", 
  "Other services and penalties", 
  "Other accruals"
];

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiFetch(url, body, headers, description) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const wait = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
        console.log(`[order-charges] ${description} — HTTP ${res.status}, retrying in ${wait / 1000}s...`);
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
      console.log(`[order-charges] ${description} — error: ${err.message}, retrying in ${wait / 1000}s...`);
      await sleep(wait);
    }
  }
  throw new Error(`[order-charges] ${description} — all ${MAX_RETRIES} attempts failed`);
}

async function fetchAllTransactions(dateFrom, dateTo, headers) {
  let page = 1;
  const pageSize = 1000;
  const allOperations = [];
  
  console.log(`[order-charges] Fetching transactions from ${dateFrom} to ${dateTo}...`);

  while (true) {
    const body = {
      filter: {
        date: { from: dateFrom, to: dateTo },
        transaction_type: "all"
      },
      page,
      page_size: pageSize
    };

    const data = await apiFetch(`${BASE_URL}/v3/finance/transaction/list`, body, headers, `Page ${page}`);
    const operations = data?.result?.operations || [];
    
    if (operations.length === 0) break;
    
    allOperations.push(...operations);
    console.log(`[order-charges] Fetched page ${page} (${operations.length} records)`);
    
    if (operations.length < pageSize || page >= data.result.page_count) break;
    page++;
  }

  console.log(`[order-charges] Total operations fetched: ${allOperations.length}`);
  return allOperations;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Discovery mode
// ─────────────────────────────────────────────────────────────────────────────
async function runDiscovery(operations) {
  console.log(`\n[order-charges] Running in Discovery Mode...`);
  
  const combinations = new Map();
  let totalAbsoluteFeeAmount = 0;

  for (const op of operations) {
    const baseKey = `${op.operation_type}|${op.operation_type_name}`;
    
    // Helper to add to map
    const addAmount = (serviceName, amount) => {
      if (amount === 0) return;
      
      const key = `${baseKey}|${serviceName}`;
      if (!combinations.has(key)) {
        combinations.set(key, {
          operation_type: op.operation_type,
          operation_type_name: op.operation_type_name,
          service_name: serviceName,
          count: 0,
          total_amount: 0
        });
      }
      
      const entry = combinations.get(key);
      entry.count += 1;
      entry.total_amount += amount;
      
      // We sum absolute amounts to calculate % share of total charges
      if (amount < 0) {
        totalAbsoluteFeeAmount += Math.abs(amount);
      } else if (serviceName !== "(top-level)") {
        // usually sales are positive, services are negative, but we include all non-sale items in fee % if requested
        // wait, the prompt says "% of total absolute fee amount". 
        // We'll just sum all absolute negative amounts to be safe, or all amounts. Let's sum all absolute amounts.
        totalAbsoluteFeeAmount += Math.abs(amount);
      }
    };

    if (op.sale_commission) addAmount("(top-level)", op.sale_commission);
    if (op.accruals_for_sale) addAmount("(top-level)", op.accruals_for_sale);
    if (op.delivery_charge) addAmount("(top-level)", op.delivery_charge);
    if (op.return_delivery_charge) addAmount("(top-level)", op.return_delivery_charge);

    if (op.services && op.services.length > 0) {
      for (const s of op.services) {
        if (s.price) addAmount(s.name, s.price);
      }
    } else {
      if (!op.sale_commission && !op.accruals_for_sale && !op.delivery_charge && !op.return_delivery_charge && op.amount !== 0) {
        addAmount("(top-level)", op.amount);
      }
    }
  }

  const results = Array.from(combinations.values()).map(c => {
    return {
      ...c,
      total_amount: Math.round(c.total_amount * 100) / 100,
      percentage_of_fees: totalAbsoluteFeeAmount > 0 
        ? ((Math.abs(c.total_amount) / totalAbsoluteFeeAmount) * 100).toFixed(2) + "%" 
        : "0.00%"
    };
  });

  // Sort by absolute amount descending
  results.sort((a, b) => Math.abs(b.total_amount) - Math.abs(a.total_amount));

  console.table(results);
  fs.writeFileSync("discovery.json", JSON.stringify(results, null, 2));
  console.log(`[order-charges] Wrote discovery.json with ${results.length} distinct combinations.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Normal run mode
// ─────────────────────────────────────────────────────────────────────────────
async function runReport(operations) {
  console.log(`\n[order-charges] Processing per-order categorized report...`);

  const orderMap = new Map(); // posting_number -> data

  for (const op of operations) {
    const postingNumber = op.posting?.posting_number || op.posting?.delivery_schema || `NoPosting_${op.operation_id}`;
    
    if (!orderMap.has(postingNumber)) {
      orderMap.set(postingNumber, {
        posting_number: postingNumber,
        order_date: op.operation_date || op.posting?.order_date || "",
        categories: {
          "Sales": 0, "Returns": 0, "Ozon referral fee": 0,
          "Delivery services": 0, "Partner services": 0,
          "Promotion and advertising": 0, "Other services and penalties": 0,
          "Other accruals": 0
        }
      });
    }

    const order = orderMap.get(postingNumber);

    const processItem = (nameForMap, amount, isReferral) => {
      if (amount === 0) return;
      if (isReferral) {
        order.categories["Ozon referral fee"] += amount;
        return;
      }

      const cat = CATEGORY_MAP[nameForMap];
      if (cat && CATEGORIES.includes(cat)) {
        order.categories[cat] += amount;
      } else {
        order.categories["Other accruals"] += amount;
        console.warn(`⚠️ Unmapped: ${nameForMap} (₽${amount}) on ${postingNumber} — add to CATEGORY_MAP`);
      }
    };

    if (op.sale_commission) processItem(op.operation_type, op.sale_commission, true);
    if (op.accruals_for_sale) processItem(op.operation_type, op.accruals_for_sale, false);
    if (op.delivery_charge) processItem(op.operation_type, op.delivery_charge, false);
    if (op.return_delivery_charge) processItem(op.operation_type, op.return_delivery_charge, false);

    if (op.services && op.services.length > 0) {
      for (const s of op.services) {
        if (s.price) processItem(s.name, s.price, false);
      }
    } else {
      if (!op.sale_commission && !op.accruals_for_sale && !op.delivery_charge && !op.return_delivery_charge && op.amount !== 0) {
        processItem(op.operation_type, op.amount, false);
      }
    }
  }

  const reports = [];
  for (const order of orderMap.values()) {
    let totalCharges = 0;
    let netToBePaid = 0;

    for (const cat of CATEGORIES) {
      const val = order.categories[cat];
      netToBePaid += val;
      if (val < 0) totalCharges += val;
    }

    order.total_charges = totalCharges;
    order.net_to_be_paid = netToBePaid;
    reports.push(order);
  }

  await generateExcel(reports);
  printSummary(reports);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Excel output
// ─────────────────────────────────────────────────────────────────────────────
async function generateExcel(reports) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folder = path.join(process.cwd(), "charges-reports", timestamp);
  fs.mkdirSync(folder, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Order Charges");

  const columns = [
    { header: "Posting Number", key: "posting_number", width: 25 },
    { header: "Order Date", key: "order_date", width: 20 },
    ...CATEGORIES.map(c => ({ header: `${c} (₽)`, key: c, width: 20 })),
    { header: "Total charges (₽)", key: "total_charges", width: 18 },
    { header: "Net to be paid (₽)", key: "net_to_be_paid", width: 18 }
  ];
  
  sheet.columns = columns;

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { name: "Calibri", size: 11, bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD965" } };

  // Track totals
  const totals = { total_charges: 0, net_to_be_paid: 0 };
  CATEGORIES.forEach(c => totals[c] = 0);

  for (const r of reports) {
    const rowValues = {
      posting_number: r.posting_number,
      order_date: r.order_date,
      total_charges: r.total_charges,
      net_to_be_paid: r.net_to_be_paid
    };

    CATEGORIES.forEach(c => {
      rowValues[c] = r.categories[c];
      totals[c] += r.categories[c];
    });
    totals.total_charges += r.total_charges;
    totals.net_to_be_paid += r.net_to_be_paid;

    const row = sheet.addRow(rowValues);

    // Percentage sub-row inline (append "(xx%)" to cell value)
    const pcRowValues = { posting_number: "↳ % of charges", order_date: "" };
    let hasCharges = r.total_charges < 0;
    
    CATEGORIES.forEach(c => {
      if (hasCharges && r.categories[c] < 0) {
        const pct = ((r.categories[c] / r.total_charges) * 100).toFixed(1) + "%";
        pcRowValues[c] = pct;
      } else {
        pcRowValues[c] = "";
      }
    });
    pcRowValues.total_charges = hasCharges ? "100%" : "";
    pcRowValues.net_to_be_paid = "";
    
    const pcRow = sheet.addRow(pcRowValues);
    pcRow.font = { italic: true, color: { argb: "FF888888" } };
  }

  // TOTAL row
  const totalRowValues = { posting_number: "TOTAL", order_date: "" };
  CATEGORIES.forEach(c => totalRowValues[c] = totals[c]);
  totalRowValues.total_charges = totals.total_charges;
  totalRowValues.net_to_be_paid = totals.net_to_be_paid;
  
  const totalRow = sheet.addRow(totalRowValues);
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };

  const filePath = path.join(folder, "charges-report.xlsx");
  await workbook.xlsx.writeFile(filePath);
  console.log(`[order-charges] Saved Excel report to ${filePath}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Console summary
// ─────────────────────────────────────────────────────────────────────────────
function printSummary(reports) {
  let sales = 0, returns = 0, referral = 0, delivery = 0;
  let partner = 0, promo = 0, otherServ = 0, otherAcc = 0;
  let totalCharges = 0, net = 0;

  for (const r of reports) {
    sales += r.categories["Sales"];
    returns += r.categories["Returns"];
    referral += r.categories["Ozon referral fee"];
    delivery += r.categories["Delivery services"];
    partner += r.categories["Partner services"];
    promo += r.categories["Promotion and advertising"];
    otherServ += r.categories["Other services and penalties"];
    otherAcc += r.categories["Other accruals"];
    totalCharges += r.total_charges;
    net += r.net_to_be_paid;
  }

  const fmt = (num) => `₽${Math.round(num * 100) / 100}`;

  console.log(`\n═════════════════════════════════════════════════════════════════════`);
  console.log(`  Sales and returns: ${fmt(sales + returns)}`);
  console.log(`    Revenue: ${fmt(sales)}   Returns: ${fmt(returns)}`);
  console.log(`  Accruals: ${fmt(totalCharges)}`);
  console.log(`    Ozon referral fee: ${fmt(referral)}   Delivery services: ${fmt(delivery)}   Partner services: ${fmt(partner)}`);
  console.log(`    Promotion and advertising: ${fmt(promo)}   Other services and penalties: ${fmt(otherServ)}   Other accruals: ${fmt(otherAcc)}`);
  console.log(`  Total to be paid for the period: ${fmt(net)}`);
  console.log(`═════════════════════════════════════════════════════════════════════\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const CLIENT_ID = process.env.OZON_CLIENT_ID;
  const API_KEY = process.env.OZON_API_KEY;

  if (!CLIENT_ID || !API_KEY) {
    console.error("[order-charges] ERROR: Missing OZON_CLIENT_ID or OZON_API_KEY environment variables.");
    process.exit(1);
  }

  const headers = {
    "Client-Id": CLIENT_ID,
    "Api-Key": API_KEY,
    "Content-Type": "application/json"
  };

  const isDiscover = process.argv.includes("--discover") || process.env.OC_MODE === "discover";

  // Default to last 30 days if not specified
  const dateFrom = process.env.FINANCE_DATE_FROM
    ? new Date(process.env.FINANCE_DATE_FROM).toISOString()
    : new Date(Date.now() - 30 * 86400000).toISOString();
  const dateTo = process.env.FINANCE_DATE_TO
    ? new Date(process.env.FINANCE_DATE_TO).toISOString()
    : new Date().toISOString();

  const operations = await fetchAllTransactions(dateFrom, dateTo, headers);

  if (isDiscover) {
    await runDiscovery(operations);
  } else {
    await runReport(operations);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
