import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchOrderDetailsBulk } from "@/lib/order-fetcher";
import { spawn } from "child_process";
import path from "path";
import { readFile, mkdir, stat } from "fs/promises";

// Helper to safely parse numbers and avoid string-number bugs
function toNumber(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    if (!accountId || !fromDate || !toDate) {
      return NextResponse.json({ error: "accountId, from, and to are required" }, { status: 400 });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Determine cache directory based on params to avoid refetching
    const cacheDirName = `cache_${accountId}_${fromDate}_${toDate}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const targetRunDir = path.join(process.cwd(), "runs", cacheDirName);
    const financeRawFile = path.join(targetRunDir, "01_finance_raw.json");

    let isCached = false;
    try {
      const s = await stat(financeRawFile);
      if (s.isFile()) {
        isCached = true;
      }
    } catch {
      isCached = false;
    }

    // ── STEP 1: Fetch all FBS orders FIRST (before finance subprocess) ─────────────────────
    // We must have posting numbers ready before spawning ozon-finance.js so it can
    // batch-fetch per-posting commission data from /v1/finance/accrual/postings.
    // The old architecture fetched orders AFTER the subprocess — that meant the
    // subprocess got an empty posting number list and fetched 0 commission records.
    const earlyMinDate = new Date(fromDate);
    earlyMinDate.setDate(earlyMinDate.getDate() - 60); // 60-day lookback buffer for trailing fees

    console.log(`[CHARGES] Fetching FBS orders (from ${earlyMinDate.toISOString().split('T')[0]} to ${toDate})...`);
    const orderDetailsMap = await fetchOrderDetailsBulk(
      account.clientId,
      account.apiKey,
      earlyMinDate.toISOString(),
      new Date(toDate + "T23:59:59Z").toISOString()
    );

    const allPostingNumbers = Array.from(orderDetailsMap.keys());
    console.log(`[CHARGES] Total FBS posting numbers: ${allPostingNumbers.length}`);
    // Sanity-check sample to confirm keys are real posting numbers
    const sample = allPostingNumbers.slice(0, 5);
    console.log(`[CHARGES] Sample posting numbers: ${JSON.stringify(sample)}`);

    if (!isCached) {
      await mkdir(targetRunDir, { recursive: true });
      const runnerPath = path.join(targetRunDir, "_finance_runner.js");

      // Embed the fresh posting numbers directly in the runner script so ozon-finance.js
      // receives them as preloadedPostingNumbers — no file I/O handshake needed.
      const runnerScript = [
        `import { fetchFinanceData } from ${JSON.stringify(path.join(process.cwd(), "ozon-finance.js").replace(/\\/g, "/"))};`,
        `import { createLogger } from ${JSON.stringify(path.join(process.cwd(), "logger.js").replace(/\\/g, "/"))};`,
        `const runDir = ${JSON.stringify(targetRunDir)};`,
        `const preloadedPostingNumbers = ${JSON.stringify(allPostingNumbers)};`,
        `const logger = createLogger(runDir);`,
        `try {`,
        `  const result = await fetchFinanceData(runDir, logger, preloadedPostingNumbers);`,
        `  await new Promise(r => setTimeout(r, 500));`,
        `  process.exit(0);`,
        `} catch (err) {`,
        `  logger.error("Finance API run failed: " + err.message);`,
        `  await new Promise(r => setTimeout(r, 500));`,
        `  process.exit(1);`,
        `}`,
      ].join("\n");

      const { writeFile } = await import("fs/promises");
      await writeFile(runnerPath, runnerScript, "utf-8");

      const env = {
        ...process.env,
        OZON_CLIENT_ID: account.clientId,
        OZON_API_KEY: account.apiKey,
        ACCOUNT_LABEL: account.name,
        FINANCE_DATE_FROM: new Date(fromDate).toISOString(),
        FINANCE_DATE_TO: new Date(toDate).toISOString(),
      };

      console.log(`[CHARGES] Spawning finance fetch subprocess with ${allPostingNumbers.length} posting numbers...`);

      await new Promise<void>((resolve, reject) => {
        const child = spawn("bun", ["run", runnerPath], {
          cwd: process.cwd(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          const s = chunk.toString();
          stdout += s;
          // Echo finance subprocess logs to the Next.js server console in real time
          process.stdout.write("[FINANCE SUBPROCESS] " + s);
        });
        child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        child.on("close", (code: number | null) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Finance fetch exited with code ${code}: ${stderr.slice(0, 600)}`));
          }
        });

        child.on("error", reject);
      });

      console.log(`[CHARGES] Finance subprocess complete.`);
    } else {
      console.log(`[CHARGES] Using cached finance data from ${financeRawFile}`);
    }

    const rawContent = await readFile(financeRawFile, "utf-8");
    const rawData = JSON.parse(rawContent);
    const operations = rawData.operations || [];

    // ── Operation type → Dashboard category classification ────────────────
    // Based on actual Ozon API field inspection.
    // RULE: Only classify operations into the known sets below. Anything not in these
    // sets falls into OTHER (if it has a reliable posting_number) or UNMAPPED (if not).

    // Delivery / logistics charged per posting
    // NOTE: MarketplaceSellerShippingCompensationReturnOperation = return logistics penalty → LOGISTICS
    const LOGISTICS_TYPES = new Set([
      "MarketplaceRedistributionOfDeliveryServicesOperation",      // Перераспределение стоимости доставки / Перевыставление услуг доставки
      "OperationMarketplaceAgencyFeeAggregator3PLGlobal",          // Агентское вознаграждение за транспортно-экспедиционные услуги
      "MarketplaceSellerShippingCompensationReturnOperation",      // Компенсация доставки при возврате (return logistics charge)
      "MarketplaceDeliveryCompensationOperation",                  // Компенсация доставки
      "Logistic", // 32
      "BackwardShipment", // 2
      "CrossDock", // 12
      "LastMile", // 28
      "LastMileCourier", // 29
      "LastMilePickUpPoint", // 30
      "ReturnFlowLogistic", // 59
      "RfbsDomesticAgentFee", // 63
      "RfbsDomesticDelivery", // 64
      "RfbsGlobalAgentFee", // 66
      "RfbsGlobalDelivery", // 67
      "Shipment", // 73
      "B2CLogistics", // 114
      "B2CBackwardLogistics", // 115
      "RfbsGlobalIntermediaryService", // 122
      "RfbsBuyerDelivery", // 124
    ]);

    // Promotion / advertising (brand-level, ads, reviews programme)
    const PROMOTION_TYPES = new Set([
      "MarketplaceServiceBrandCommission",         // Продвижение бренда
      "OperationMarketplacePromotionAds",          // Рекламная кампания
      "MarketplaceAdvertisingBudgetTransfer",      // Перевод рекламного бюджета
      "OperationMarketplacePromotionSearch",       // Поиск — продвижение
      "OperationMarketplacePerformancePremium",    // Performance Premium
      "BrandCommission", // 3
      "BrandPromotion", // 4
      "BrandShelf", // 5
      "Promotion", // 54
      "ExternalPromotion", // 19
      "Marketing", // 33
      "PayPerClick", // 41
      "Stencil", // 75
    ]);

    // Return-related operations: ADDITIONAL costs only (storage, partial comp).
    const RETURNS_TYPES = new Set([
      "MarketplaceReturnStorageServiceAtTheWarehouseOperation",  // Хранение при возврате на складе
      "OperationMarketplaceServicePartialCompensationToClient",  // Частичная компенсация покупателю
      "ClientReturn", // 9
      "PartialReturn", // 40
      "ReturnStorageInTheWarehouse", // 60
      "SellerReturns", // 71
    ]);

    // Partner services (Ozon Stars, premium seller programs)
    const PARTNER_SERVICE_TYPES = new Set([
      "StarsMembership",                    // Звёздные товары (per-order)
      "ItemAgentServiceStarsMembership",    // service-level sub-entry of StarsMembership
      "OperationSubscriptionPremium",       // Подписка Premium
      "PremiumMembership", // 51
      "PremiumSubscription", // 52
    ]);

    // Acquiring / payment processing — charged per order
    const ACQUIRING_TYPES = new Set([
      "MarketplaceRedistributionOfAcquiringOperation",  // Оплата эквайринга
      "Acquiring", // 1
    ]);

    // Defect/cancellation fines — charged per order (posting_number present)
    const DEFECT_FINE_TYPES = new Set([
      "DefectFineCancellation",     // Превышение индекса ошибок: отмена (seller cancellation penalty)
      "DefectFineDelayedShipment",  // Штраф за задержку отгрузки
      "DefectFine",                 // Generic defect fine
      "DefectRate", // 14
      "DefectFineModeration", // 89
      "DefectFineProhibitedGoods", // 90
      "DefectFineCounterfeitGoods", // 91
      "DefectFineComplaint", // 92
      "DefectFineErrors", // 93
      "DefectFineShipmentDelayRate", // 94
    ]);

    // Account-level promotion — no reliable per-order mapping
    const ACCOUNT_LEVEL_PROMOTION_TYPES = new Set([
      "OperationMarketplaceAcceleratedProductReviews",  // Ускоренный сбор отзывов
      "AcceleratedReviewCollection", // 96
    ]);

    // Posting numbers that are NOT real order posting numbers (dates, period strings, etc.)
    // These look like "01.08.26-01.09.26" or similar non-order identifiers
    function isRealPostingNumber(pn: string | null | undefined): boolean {
      if (!pn || pn.trim() === "") return false;
      // Real FBS posting numbers match: digits-digits[-digits] e.g. "38933458-0097-1"
      // Subscription-like strings: "01.08.26-01.09.26" contain dots → NOT a real posting
      if (/\./.test(pn)) return false;
      return true;
    }

// ── Aggregation state ─────────────────────────────────────────────────
    const mappedOrders = new Map<string, any>();
    const unmappedCharges: any[] = [];
    const seenOperationIds = new Set<string>();

    let totalGrossSales = 0;
    let totalOzonCharges = 0;
    let totalMappedCharges = 0;
    let totalUnmappedCharges = 0;
    let netAmount = 0;

    // Reconciliation table tracking
    const reconciliation: Record<string, { api_total: number; mapped: number; unmapped: number }> = {
      "Sales / Revenue": { api_total: 0, mapped: 0, unmapped: 0 },
      "Returns": { api_total: 0, mapped: 0, unmapped: 0 },
      "Partner programs": { api_total: 0, mapped: 0, unmapped: 0 },
      "Points for discounts": { api_total: 0, mapped: 0, unmapped: 0 },
      "Partner services": { api_total: 0, mapped: 0, unmapped: 0 },
      "Ozon fee / commission": { api_total: 0, mapped: 0, unmapped: 0 },
      "Delivery services": { api_total: 0, mapped: 0, unmapped: 0 },
      "Promotion and advertising": { api_total: 0, mapped: 0, unmapped: 0 },
      "Other accruals": { api_total: 0, mapped: 0, unmapped: 0 },
      "Other services / penalties / corrections": { api_total: 0, mapped: 0, unmapped: 0 },
    };

    function trackRecon(cat: string, amt: number, isMapped: boolean) {
      if (!reconciliation[cat]) {
        reconciliation[cat] = { api_total: 0, mapped: 0, unmapped: 0 };
      }
      reconciliation[cat].api_total += amt;
      if (isMapped) reconciliation[cat].mapped += amt;
      else reconciliation[cat].unmapped += amt;
    }

    // orderDetailsMap was already fetched before the finance subprocess above.
    // No second fetch needed — we reuse the same map.
    console.log(`[CHARGES] Processing ${operations.length} finance operations against ${orderDetailsMap.size} FBS orders...`);

    for (const op of operations) {
      const opId = String(op.operation_id);
      if (seenOperationIds.has(opId)) continue;
      seenOperationIds.add(opId);

      const raw = op.posting?.posting_number || op.posting_number || op.order_number || op.posting?.order_id || op.order_id;
      const rawPostingNumber = raw ? String(raw) : null;
      // Only treat a posting_number as valid if it looks like a real FBS posting
      const postingNumber = isRealPostingNumber(rawPostingNumber) ? rawPostingNumber : null;
      const amount = toNumber(op.amount);
      const accrualsForSale = toNumber(op.accruals_for_sale);
      const saleCommission = toNumber(op.sale_commission);
      const opType = op.operation_type || "";

      let chargeCategory = "";
      
      let txSalesAmount = 0;
      let txCommission = 0;
      let txLogistics = 0;
      let txReturns = 0;
      let txPromotion = 0;
      let txPartnerServices = 0;
      let txOtherServices = 0;
      
      let txChargeContribution = 0;
      let mappingSource = postingNumber ? "posting_number match" : "none";
      const isMapped = !!postingNumber && !ACCOUNT_LEVEL_PROMOTION_TYPES.has(opType);
      
      let ozonUiCategory = "Other accruals";

      if (opType === "OperationAgentDeliveredToCustomer" || opType === "v1_POSTING_SALE") {
        txSalesAmount = accrualsForSale;  
        txCommission = saleCommission;    
        txChargeContribution = txCommission; 
        chargeCategory = "Order Payout (Sales − Commission)";
        
        trackRecon("Sales / Revenue", txSalesAmount, isMapped);
        trackRecon("Ozon fee / commission", txCommission, isMapped);
        ozonUiCategory = "Ozon fee / commission"; 
      } else if (opType === "ClientReturnAgentOperation" || opType === "OperationAgentStornoDeliveredToCustomer" || opType === "v1_POSTING_RETURN") {
        txReturns    = accrualsForSale;      
        txCommission = saleCommission;       
        txChargeContribution = saleCommission; 
        chargeCategory = "Client Return (Sale Reversal)";
        
        trackRecon("Returns", txReturns, isMapped);
        trackRecon("Ozon fee / commission", txCommission, isMapped);
        ozonUiCategory = "Returns"; 
      } else if (opType === "v1_POSTING_OTHER") {
        txOtherServices = amount;
        txChargeContribution = amount;
        chargeCategory = `Other Posting Accrual`;
        ozonUiCategory = "Other accruals";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else if (LOGISTICS_TYPES.has(opType)) {
        txLogistics = amount;
        txChargeContribution = amount;
        chargeCategory = `Logistics (${op.operation_type_name || opType})`;
        ozonUiCategory = "Delivery services";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else if (RETURNS_TYPES.has(opType)) {
        txReturns = amount;
        txChargeContribution = amount;
        chargeCategory = `Returns (${op.operation_type_name || opType})`;
        ozonUiCategory = "Returns";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else if (PROMOTION_TYPES.has(opType)) {
        txPromotion = amount;
        txChargeContribution = amount;
        chargeCategory = `Promotion (${op.operation_type_name || opType})`;
        ozonUiCategory = "Promotion and advertising";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else if (ACCOUNT_LEVEL_PROMOTION_TYPES.has(opType)) {
        txPromotion = amount;
        txChargeContribution = amount;
        chargeCategory = `Promotion/Account-Level (${op.operation_type_name || opType})`;
        ozonUiCategory = "Promotion and advertising";
        trackRecon(ozonUiCategory, amount, false);
      } else if (PARTNER_SERVICE_TYPES.has(opType)) {
        txPartnerServices = amount;
        txChargeContribution = amount;
        chargeCategory = `Partner Services (${op.operation_type_name || opType})`;
        ozonUiCategory = "Partner services";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else if (ACQUIRING_TYPES.has(opType)) {
        txOtherServices = amount;
        txChargeContribution = amount;
        chargeCategory = `Acquiring Fee (${op.operation_type_name || opType})`;
        ozonUiCategory = "Other accruals";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else if (DEFECT_FINE_TYPES.has(opType)) {
        txOtherServices = amount;
        txChargeContribution = amount;
        chargeCategory = `Penalty/Fine (${op.operation_type_name || opType})`;
        ozonUiCategory = "Other services / penalties / corrections";
        trackRecon(ozonUiCategory, amount, isMapped);
      } else {
        txOtherServices = amount;
        txChargeContribution = amount;
        chargeCategory = `Other (${op.operation_type_name || opType})`;
        ozonUiCategory = "Other accruals";
        trackRecon(ozonUiCategory, amount, isMapped);
      }

      if (postingNumber && isMapped) {
        totalGrossSales += txSalesAmount;
        totalOzonCharges += txChargeContribution;
      } else {
        totalUnmappedCharges += txChargeContribution;
      }
      netAmount += (txSalesAmount + txChargeContribution);

      const txDetail = {
        operation_id: op.operation_id,
        operation_date: op.operation_date,
        operation_type: opType,
        operation_type_name: op.operation_type_name,
        type_id: op.type_id || op.type || null,
        ozon_ui_category: ozonUiCategory,
        mapping_source: isMapped ? mappingSource : "none",
        posting_number: rawPostingNumber || null,
        order_id: op.posting?.order_id || null,
        sku: (op.items && op.items.length > 0) ? op.items.map((i: any) => i.sku) : [],
        services: op.services || [],
        amount: amount,
        accruals_for_sale: accrualsForSale,
        sale_commission: saleCommission,
        charge_category: chargeCategory,
      };

      if (!isMapped) {
        let reason = "";
        if (ACCOUNT_LEVEL_PROMOTION_TYPES.has(opType) || opType === "OperationSubscriptionPremium") {
          reason = "Type is account-level";
        } else if (!raw) {
          reason = "No posting_number or order_id provided by Ozon";
        } else if (raw && !isRealPostingNumber(String(raw))) {
          reason = "No reliable order reference in API response (invalid format)";
        } else {
          reason = "Seller/account-level accrual";
        }
        
        unmappedCharges.push({
          ...txDetail,
          reason,
        });
        continue;
      }

            totalMappedCharges += txChargeContribution;

      if (!mappedOrders.has(postingNumber)) {
        mappedOrders.set(postingNumber, {
          order_number: op.posting?.order_id || postingNumber,
          posting_number: postingNumber,
          order_date: op.posting?.order_date,
          skus: new Set<string>(),
          sku_quantities: {} as Record<string, number>,
          product_names: new Set<string>(),
          gross_sales: 0,
          returns_sales: 0,
          sales_source: "finance",
          commission: 0,
          logistics: 0,
          returns: 0,
          promotion: 0,
          partner_services: 0,
          other_services: 0,
          total_charges: 0,
          net_amount: 0,
          transactions: [],
          return_transactions: [],  // ClientReturnAgentOperation / Storno details
          return_logistics_total: 0, // MarketplaceSellerShippingCompensationReturnOperation
        });
      }

      const order = mappedOrders.get(postingNumber);

      const items = op.items || [];
      const opSkus = items.map((i: any) => i.sku).filter(Boolean);
      const opNames = items.map((i: any) => i.name).filter(Boolean);
      items.forEach((i: any) => {
        if (i.sku) {
          order.skus.add(String(i.sku));
          const qty = i.quantity || 0;
          order.sku_quantities[String(i.sku)] = Math.max(order.sku_quantities[String(i.sku)] || 0, qty);
        }
      });
      opNames.forEach((n: string) => order.product_names.add(n));

      // Track whether this posting had a sale operation (positive accruals) or only a return/storno
      if (opType === "OperationAgentDeliveredToCustomer") {
        order.had_sale_op = true;
      }
      if (opType === "ClientReturnAgentOperation" || opType === "OperationAgentStornoDeliveredToCustomer") {
        order.had_return_op = true;
        // Store return transaction details for the expanded view
        order.return_transactions.push({
          operation_id: op.operation_id,
          operation_date: op.operation_date,
          operation_type: opType,
          posting_number: rawPostingNumber || null,
          order_id: op.posting?.order_id || null,
          refund_amount: toNumber(op.accruals_for_sale),  // negative product reversal
          commission_reversal: toNumber(op.sale_commission), // positive commission refund
          items: (op.items || []).map((i: any) => ({
            sku: i.sku,
            name: i.name,
            quantity: i.quantity ?? null,
          })),
        });
      }
      // Track return logistics separately for the expanded view
      if (opType === "MarketplaceSellerShippingCompensationReturnOperation") {
        order.return_logistics_total += toNumber(op.amount);
      }

      if (txSalesAmount > 0) {
        order.gross_sales += txSalesAmount;
      } else if (txSalesAmount < 0) {
        order.returns_sales += txSalesAmount; // Negative values (legacy, kept for isTrailingFeeOnly)
      }

      order.commission += txCommission;
      order.logistics += txLogistics;
      order.returns += txReturns;
      order.promotion += txPromotion;
      order.partner_services += txPartnerServices;
      order.other_services += txOtherServices;
      
      // For v1_POSTING_SALE, amount is just the commission. So net_amount needs both the sale revenue and the charge.
      // For other fees, amount is just the charge.
      order.net_amount += (txSalesAmount + txChargeContribution);
      order.total_charges += txChargeContribution;

      order.transactions.push(txDetail);
    }

    for (const order of mappedOrders.values()) {
      const externalData = orderDetailsMap.get(order.posting_number);
      
      if (externalData) {
        // Always augment SKUs and names from the FBS order API if finance record was sparse
        if (externalData.skus && externalData.skus.length > 0) {
          externalData.skus.forEach((s: string) => order.skus.add(String(s)));
        }
        if (externalData.names && externalData.names.length > 0) {
          externalData.names.forEach((n: string) => order.product_names.add(n));
        }

        // Store the FBS order status on the order object for display (e.g. 'cancelled')
        if (externalData.order_status) {
          order.fbs_order_status = externalData.order_status;
        }

        // Trailing-fee fallback:
        // If no OperationAgentDeliveredToCustomer or ClientReturnAgentOperation appeared in the
        // selected finance period, this is either:
        //  a) A "trailing fee" posting — service charges for an order settled in a prior period.
        //  b) A cancelled order that only has penalty charges (e.g. DefectFineCancellation).
        //
        // We want to show the original RUB selling price as ORDER VALUE.
        // Priority of fallback sources (most to least reliable):
        //  1. externalData.price if price_is_rub===true  (RUB-listed products)
        //  2. externalData.price_customer_rub             (financial_data.customer_price — ALWAYS RUB,
        //     even for cross-border sellers who list in USD/EUR)
        // Never use a raw USD/EUR amount as ₽ — that produced the 5 ₽ / 13.49 ₽ bugs.
        const isTrailingOrFeeOnly = order.gross_sales === 0 && !order.had_sale_op && !order.had_return_op;
        if (isTrailingOrFeeOnly) {
          if (externalData.price > 0 && externalData.price_is_rub !== false) {
            // RUB-listed order — use listing price directly
            order.gross_sales = externalData.price;
            order.sales_source = "order_api";
          } else if (externalData.price_customer_rub > 0) {
            // Cross-border (USD/EUR) seller: use financial_data.customer_price which is always RUB
            order.gross_sales = externalData.price_customer_rub;
            order.sales_source = "customer_price_rub";
          }
          // If neither source has a value: gross_sales stays 0 — do NOT invent data
        }
      }
    }

    const formattedOrders = Array.from(mappedOrders.values()).map(o => {
      const gross_sales = Math.round(o.gross_sales * 100) / 100;
      const returns_val = Math.round(o.returns * 100) / 100;
      // net_sales: original order value + RETURNS (which is negative for returned orders)
      // e.g. ORDER VALUE=1733, RETURNS=-1733 → NET SALES=0
      const net_sales = Math.round((gross_sales + returns_val) * 100) / 100;

      // Build return_info for expanded view
      const hasReturn = o.return_transactions.length > 0;
      const return_info = hasReturn
        ? {
            has_return: true,
            return_status: "Returned",
            transactions: o.return_transactions.map((rt: any) => ({
              operation_id: rt.operation_id,
              date: rt.operation_date,
              operation_type: rt.operation_type,
              posting_number: rt.posting_number,
              order_id: rt.order_id,
              refund_amount: Math.round(rt.refund_amount * 100) / 100,
              commission_reversal: Math.round(rt.commission_reversal * 100) / 100,
              items: rt.items,
              returned_quantity: rt.items.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
            })),
            total_refund_amount: Math.round(
              o.return_transactions.reduce((s: number, rt: any) => s + rt.refund_amount, 0) * 100
            ) / 100,
            return_logistics_charge: Math.round(o.return_logistics_total * 100) / 100,
          }
        : { has_return: false, return_status: "No return" };

      const total_quantity = Object.values(o.sku_quantities as Record<string, number>).reduce((sum, q) => sum + q, 0);

      return {
        ...o,
        skus: Array.from(o.skus),
        total_quantity,
        product_names: Array.from(o.product_names),
        gross_sales,
        returns_sales: Math.round(o.returns_sales * 100) / 100,
        net_sales,
        commission: Math.round(o.commission * 100) / 100,
        logistics: Math.round(o.logistics * 100) / 100,
        returns: returns_val,
        partner_services: Math.round(o.partner_services * 100) / 100,
        promotion: Math.round(o.promotion * 100) / 100,
        other_services: Math.round(o.other_services * 100) / 100,
        total_charges: Math.round(o.total_charges * 100) / 100,
        net_amount: Math.round(o.net_amount * 100) / 100,
        return_info,
        fbs_order_status: o.fbs_order_status || null,
        // Internal fields not needed on the client
        return_transactions: undefined,
        return_logistics_total: undefined,
      };
    });

    return NextResponse.json({
      success: true,
      summary: {
        account: account.name,
        from: fromDate,
        to: toDate,
        total_finance_transactions: operations.length,
        mapped_transactions: Array.from(seenOperationIds).length - unmappedCharges.length,
        unmapped_transactions: unmappedCharges.length,
        mapped_orders: formattedOrders.length,
        totalItems: formattedOrders.reduce((sum, o) => sum + (o.total_quantity || 0), 0),
        totalSales: Math.round(totalGrossSales * 100) / 100,
        totalReturnsSales: Math.round(formattedOrders.reduce((sum, o) => sum + o.returns_sales, 0) * 100) / 100,
        netSales: Math.round(formattedOrders.reduce((sum, o) => sum + o.net_sales, 0) * 100) / 100,
        totalOzonCharges: Math.round(totalOzonCharges * 100) / 100,
        totalMappedCharges: Math.round(totalMappedCharges * 100) / 100,
        totalUnmappedCharges: Math.round(totalUnmappedCharges * 100) / 100,
        netAmount: Math.round(netAmount * 100) / 100,
      },
      // Sort logic: 
      // 1. Orders with gross_sales > 0 (or had_sale_op) come first
      // 2. Then sort by order_date descending
      // 3. Invalid dates go to the bottom
      reconciliation, orders: formattedOrders.sort((a, b) => {
        // Primary sort: has sales vs no sales
        const aHasSales = a.gross_sales > 0 ? 1 : 0;
        const bHasSales = b.gross_sales > 0 ? 1 : 0;
        
        if (aHasSales !== bHasSales) {
          return bHasSales - aHasSales;
        }

        // Secondary sort: date descending
        const ta = a.order_date ? new Date(a.order_date).getTime() : 0;
        const tb = b.order_date ? new Date(b.order_date).getTime() : 0;
        const validA = !isNaN(ta) && ta > 0;
        const validB = !isNaN(tb) && tb > 0;
        if (validA && validB) return tb - ta;
        if (validA) return -1; // a has valid date → comes first
        if (validB) return 1;  // b has valid date → comes first
        return 0;
      }),
      unmapped: unmappedCharges,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
