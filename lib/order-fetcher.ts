import { createLogger } from "./logger.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export async function fetchOrderDetailsBulk(clientId, apiKey, minDateStr, maxDateStr) {
  const headers = {
    "Client-Id": clientId,
    "Api-Key": apiKey,
    "Content-Type": "application/json",
  };

  const results = new Map();
  let cursor = "";
  const limit = 100;
  let batchNum = 0;

  try {
    while (true) {
      let res;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        res = await fetch("https://api-seller.ozon.ru/v4/posting/fbs/list", {
          method: "POST",
          headers,
          body: JSON.stringify({
            filter: {
              since: minDateStr,
              to: maxDateStr,
            },
            limit,
            cursor: cursor || undefined,
            with: { financial_data: true }
          }),
        });
        if (res.ok || res.status === 400 || res.status === 404) break;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }

      if (!res || !res.ok) {
        break;
      }

      const data = await res.json();
      const postings = data.postings || [];
      batchNum++;
      console.log(`[CHARGES][FBS] Batch ${batchNum} | requested=${limit} | received=${postings.length}`);
      if (postings.length === 0) break;

      for (const p of postings) {
        // Compute total selling price from products[].
        // IMPORTANT: Cross-border (global) sellers list prices in non-RUB currencies (e.g. USD).
        // We check currency_code per product:
        //   - If ALL products are RUB → use products[].price * quantity
        //   - If ANY product is non-RUB (e.g. USD) → price = 0 from this source,
        //     but we also read financial_data.products[].customer_price which is ALWAYS in RUB.
        let totalListPrice = 0;    // sum of products[].price (in seller currency)
        let totalCustomerPrice = 0; // sum of financial_data.products[].customer_price (always RUB)
        let totalQty = 0;
        let allRub = true;
        const skus = [];
        const names = [];
        const currencies = new Set<string>();

        if (p.products) {
          for (const prod of p.products) {
            const currency = (prod.currency_code || "").toUpperCase();
            currencies.add(currency || "UNKNOWN");
            if (currency && currency !== "RUB") {
              allRub = false;
            }
            const unitPrice = parseFloat(prod.price) || 0;
            const qty = parseInt(prod.quantity, 10) || 1;
            totalListPrice += unitPrice * qty;
            totalQty += qty;
            if (prod.sku) skus.push(prod.sku);
            if (prod.name) names.push(prod.name);
          }
        }

        // financial_data.products[].customer_price is the price the customer actually paid in RUB.
        // This is reliable for cross-border orders where products[].price is in USD/EUR/etc.
        // It represents the actual transaction value from the customer's perspective.
        if (p.financial_data?.products) {
          for (const fd of p.financial_data.products) {
            const cprice = parseFloat(fd.customer_price) || 0;
            const qty = parseInt(fd.quantity, 10) || 1;
            totalCustomerPrice += cprice * qty;
          }
        }

        results.set(p.posting_number, {
          // price: use RUB list price if available, otherwise 0.
          // price_customer_rub: always-RUB customer_price for non-RUB sellers.
          // The route.ts fallback prefers: accruals_for_sale → price (if RUB) → price_customer_rub.
          price: allRub ? totalListPrice : 0,
          price_customer_rub: totalCustomerPrice,  // always in RUB, use for cross-border fallback
          price_is_rub: allRub,
          currencies: Array.from(currencies),
          quantity: totalQty,
          skus,
          names,
          order_status: p.status || "",
        });
      }

      if (!data.has_next || !data.cursor) break;
      cursor = data.cursor;
    }
    console.log(`[CHARGES][FBS] TOTAL FBS ORDERS FETCHED = ${results.size}`);
  } catch (err) {
    console.error("Order bulk fetch failed:", err);
  }

  return results;
}
