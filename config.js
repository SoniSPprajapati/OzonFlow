/**
 * config.js
 * Centralized configuration for the Ozon pipeline.
 */

export const CONFIG = {
    // Ozon API Status to fetch
    STATUS: process.env.STATUS || "awaiting_packaging",

    // Default days back to fetch
    DAYS_BACK: parseInt(process.env.DAYS_BACK, 10) || 30,

    // Finance: days back to fetch financial transactions (max 31 per Ozon API request, auto-chunked)
    FINANCE_DAYS_BACK: parseInt(process.env.FINANCE_DAYS_BACK, 10) || 30,

    // Order limit (null = fetch all)
    ORDER_LIMIT: !isNaN(parseInt(process.env.ORDER_LIMIT, 10))
        ? parseInt(process.env.ORDER_LIMIT, 10)
        : null,

    // Filenames used within each run directory
    filenames: {
        raw: "01_data_raw.json",
        translated: "02_data_translated.json",
        excel: "03_report.xlsx",
        log: "pipeline.log",
        renderDir: "render",
        finalPdf: "final.pdf",

        // Finance module output files
        financeRaw:    "01_finance_raw.json",
        financeTotals: "01_finance_totals.json"
    }
};
