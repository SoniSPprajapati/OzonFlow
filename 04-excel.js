#!/usr/bin/env bun

import path from 'path';
import ExcelJS from 'exceljs';
import { CONFIG } from "./config.js";

/**
 * json-to-xlsx.js
 * Converts Ozon orders JSON to xlsx matching the Frostrek LLP sheet structure.
 *
 * Column mapping:
 *   SHIPMENT NUMBER    <- posting_number
 *   Customer's name    <- customer.name
 *   Delivery address   <- customer.address.address_tail
 *   Pick-up point code <- customer.address.pvz_code (0 or falsy = blank)
 *   Delivery cluster   <- financial_data.cluster_to
 *   PRODUCT            <- products.name (joined)
 *   PRICE (INR)        <- Calculated based on order total (USD)
 * Price Decision Logic (Frostrek Bracket):
 *   Total USD >= 30: $7.70
 *   Total USD >= 25: $6.60
 *   Total USD >= 20: $5.50
 *   Total USD >= 15: $4.40
 *   Total USD >= 05: $3.30 (Default)
 *   Else: $3.30
 *
 * These USD prices are then converted to INR using live exchange rates.
 * 
 * Note: The "Comment" column is intentionally left empty for manual company use.
 */
export async function exportToExcel(runDir, logger, financeData = null) {
  const inputFile = path.join(runDir, CONFIG.filenames.translated);
  const outputFile = path.join(runDir, CONFIG.filenames.excel);

  const HEADERS = ["SHIPMENT NUMBER", "Customer's full name", "Delivery address", "Pick-up point code", "Delivery cluster", "PRODUCT", "PRICE (INR)", "Comment"];
  const COL_WIDTHS = [28, 28, 60, 20, 28, 55, 14, 20];
  const FALLBACK_RATE = 84;
  const PRICE_BRACKETS = [{ min: 30, fee: 7.7 }, { min: 25, fee: 6.6 }, { min: 20, fee: 5.5 }, { min: 15, fee: 4.4 }, { min: 5, fee: 3.3 }];
  const DEFAULT_FEE_USD = 3.3;

  function getBracketFeeUsd(totalUsd) {
    for (const bracket of PRICE_BRACKETS) {
      if (totalUsd >= bracket.min) return bracket.fee;
    }
    return DEFAULT_FEE_USD;
  }

  async function fetchUsdToInrRate() {
    const sources = [
      { name: 'fawazahmed0/currency-api', url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json', parse: d => d?.usd?.inr },
      { name: 'exchangerate-api.com', url: 'https://api.exchangerate-api.com/v4/latest/USD', parse: d => d?.rates?.INR },
    ];
    for (const source of sources) {
      try {
        const res = await fetch(source.url);
        if (!res.ok) continue;
        const rate = source.parse(await res.json());
        if (rate) {
          logger.info(`💱 USD→INR rate: ${rate} (via ${source.name})`);
          return rate;
        }
      } catch (e) {
        logger.warn(`⚠️ ${source.name} failed: ${e.message}.`);
      }
    }
    logger.warn(`⚠️ All rate sources failed. Using fallback: ${FALLBACK_RATE}`);
    return FALLBACK_RATE;
  }

  function mapOrder(order, usdToInr) {
    const addr = order.customer?.address ?? {};
    const products = Array.isArray(order.products) ? order.products : [];
    const productNames = products.map(p => p?.name?.trim()).filter(Boolean).join(', ');

    const totalUsd = products.reduce((sum, p) => sum + (parseFloat(p?.price) || 0) * (parseInt(p?.quantity) ?? 1), 0);
    const feeUsd = getBracketFeeUsd(totalUsd);
    const feeInr = Math.round(feeUsd * usdToInr);

    return [
      order.posting_number ?? '',
      order.customer?.name?.trim() ?? '',
      addr.address_tail?.trim() ?? '',
      addr.pvz_code ? String(addr.pvz_code) : '',
      order.financial_data?.cluster_to?.trim() ?? '',
      productNames,
      feeInr,
      '', // Comment is left empty by design
    ];
  }

  const inputBunFile = Bun.file(inputFile);
  if (!(await inputBunFile.exists())) throw new Error(`Input file not found: ${inputFile}`);
  const orders = await inputBunFile.json();

  const usdToInr = await fetchUsdToInrRate();
  const rows = orders.map(order => mapOrder(order, usdToInr));

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  const headerRow = worksheet.addRow(HEADERS);
  headerRow.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD965' } };
  });

  for (const rowData of rows) {
    const row = worksheet.addRow(rowData);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: 11 };
      cell.alignment = { vertical: 'top' };
    });
  }

  COL_WIDTHS.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });

  // ── Finance Details sheet (new — only added when financeData is provided) ──
  if (financeData && Array.isArray(financeData.transactions) && financeData.transactions.length > 0) {
    addFinanceDetailsSheet(workbook, financeData.transactions, logger);
  }

  // ── Partner Services sheet (new — only added when there are partner service records) ──
  if (financeData && Array.isArray(financeData.partnerServices) && financeData.partnerServices.length > 0) {
    addPartnerServicesSheet(workbook, financeData.partnerServices, logger);
  }

  await workbook.xlsx.writeFile(outputFile);
  logger.info(`✅ Excel report saved with ${rows.length} rows to ${outputFile}`);
  return { rate: usdToInr };
}

// ─────────────────────────────────────────────────────────────────────────────
// Finance Details sheet
// All values come from the actual Ozon API response — no estimates.
// ─────────────────────────────────────────────────────────────────────────────

function addFinanceDetailsSheet(workbook, transactions, logger) {
  const ws = workbook.addWorksheet('Finance Details');

  const FIN_HEADERS = [
    'Account',
    'Operation Date',
    'Order Number',
    'Posting Number',
    'SKU',
    'Product Name',
    'Quantity',
    'SKU Mapping Status',
    'Sale Amount / Accruals for Sale',
    'Ozon Commission',
    'Delivery / Logistics Charge',
    'Return Delivery Charge',
    'Other Services (JSON)',
    'Total Transaction Amount',
    'Ozon Operation Type',
    'Ozon Operation Type Name',
    'Operation ID',
  ];

  const FIN_COL_WIDTHS = [20, 22, 20, 28, 14, 40, 10, 24, 32, 20, 28, 24, 40, 26, 28, 36, 20];

  const headerRow = ws.addRow(FIN_HEADERS);
  headerRow.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB8CCE4' } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });

  for (const tx of transactions) {
    // Services that are NOT partner services — serialise as JSON for auditability
    const otherServices = (tx.services ?? []).filter(
      s => !((s.name ?? '').toLowerCase().includes('partner'))
    );
    const otherServicesJson = otherServices.length > 0
      ? JSON.stringify(otherServices.map(s => ({ name: s.name, price: s.price })))
      : '';

    const rowData = [
      tx.account ?? '',
      tx.operation_date ?? '',
      tx.order_number ?? '',
      tx.posting_number ?? '',
      tx.sku ?? '',
      tx.product_name ?? '',
      tx.quantity ?? '',
      tx.sku_mapping_status ?? '',
      tx.accruals_for_sale ?? '',          // ACTUAL API value
      tx.sale_commission ?? '',            // ACTUAL API value
      tx.delivery_charge ?? '',            // ACTUAL API value
      tx.return_delivery_charge ?? '',     // ACTUAL API value
      otherServicesJson,
      tx.amount ?? '',                     // ACTUAL API value — total transaction amount
      tx.operation_type ?? '',
      tx.operation_type_name ?? '',
      tx.operation_id ?? '',
    ];

    const row = ws.addRow(rowData);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = { vertical: 'top', wrapText: false };
    });
  }

  FIN_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  logger.info(`✅ Finance Details sheet added with ${transactions.length} row(s)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner Services sheet
// Only rows where Ozon API returned a service with "partner" in the name.
// Service name and amount are ORIGINAL Ozon values — no guessing.
// ─────────────────────────────────────────────────────────────────────────────

function addPartnerServicesSheet(workbook, partnerServices, logger) {
  const ws = workbook.addWorksheet('Partner Services');

  const PS_HEADERS = [
    'Account',
    'Operation Date',
    'Order Number',
    'Posting Number',
    'SKU',
    'Product Name',
    'SKU Mapping Status',
    'Ozon Operation Type',
    'Ozon Operation Type Name',
    'Service Name',            // ORIGINAL Ozon service name
    'Service Amount',          // ORIGINAL Ozon service amount
    'Operation ID',
  ];

  const PS_COL_WIDTHS = [20, 22, 20, 28, 14, 40, 24, 28, 36, 36, 16, 20];

  const headerRow = ws.addRow(PS_HEADERS);
  headerRow.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });

  for (const ps of partnerServices) {
    const rowData = [
      ps.account ?? '',
      ps.operation_date ?? '',
      ps.order_number ?? '',
      ps.posting_number ?? '',
      ps.sku ?? '',
      ps.product_name ?? '',
      ps.sku_mapping_status ?? '',
      ps.operation_type ?? '',
      ps.operation_type_name ?? '',
      ps.service_name ?? '',     // ORIGINAL Ozon service name
      ps.service_amount ?? '',   // ORIGINAL Ozon service amount
      ps.operation_id ?? '',
    ];

    const row = ws.addRow(rowData);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Calibri', size: 10 };
      cell.alignment = { vertical: 'top' };
    });
  }

  PS_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  logger.info(`✅ Partner Services sheet added with ${partnerServices.length} row(s)`);
}