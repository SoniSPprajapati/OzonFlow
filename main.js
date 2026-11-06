#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import path from "path";
import { createLogger } from "./logger.js";
import { fetchOrders } from "./01-fetch-orders.js";
import { translateOrders } from "./02-translate.js";
import { generatePdfs } from "./03-generate.js";
import { exportToExcel } from "./04-excel.js";
import { notifySuccess, notifyFailure, notifyNoOrders } from "./05-notify.js";
import { CONFIG } from "./config.js";
import { fetchFinanceData } from "./ozon-finance.js";

async function main() {
    const start = performance.now();

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16).replace("T", "_");
    const runDirName = `${timestamp}_run`;
    const runDir = path.join(process.cwd(), "runs", runDirName);

    await mkdir(runDir, { recursive: true });

    const logger = createLogger(runDir);

    logger.info("=".repeat(60));
    logger.info("🚀 UNIFIED OZON PIPELINE STARTED");
    logger.info(`📂 Run Directory: ${runDir}`);
    logger.info(`⚙️  Config: STATUS=${CONFIG.STATUS}, LIMIT=${CONFIG.ORDER_LIMIT || 'ALL'}`);
    logger.info("=".repeat(60));

    let orderCount = 0;

    try {
        // Stage 1: Fetch
        logger.info("\n--- STAGE 1: FETCHING ---");
        const { count } = await fetchOrders(runDir, logger);
        orderCount = count;

        if (count === 0) {
            logger.warn("Stopping pipeline: No orders to process.");
            await writeMeta(runDir, { runDir, orders: 0, duration: "0s", rate: "N/A", status: "skipped" });
            await notifyNoOrders({ logger });
            return;
        }

        // Stage 2: Translate
        logger.info("\n--- STAGE 2: TRANSLATING ---");
        await translateOrders(runDir, logger);

        // Stage 3: Generate PDFs
        logger.info("\n--- STAGE 3: GENERATING PDFs ---");
        await generatePdfs(runDir, logger);

        // Stage 4: Excel Export
        logger.info("\n--- STAGE 4: EXPORTING EXCEL ---");

        // Stage 4a: Finance Data (optional — failure never breaks existing pipeline)
        logger.info("\n--- STAGE 4a: FETCHING FINANCE DATA ---");
        let financeData = null;
        try {
            financeData = await fetchFinanceData(runDir, logger);
            if (financeData.error) {
                logger.warn(`⚠️  Finance fetch returned an error: ${financeData.error}`);
            } else {
                logger.info(`✅ Finance fetch complete — ${financeData.transactions.length} transaction(s)`);
                if (!financeData.reconciliationOk) {
                    logger.warn("⚠️  Finance reconciliation mismatch — see finance log above for details");
                }
            }
        } catch (finErr) {
            // Finance is an ADDITIONAL module — its failure must never stop the main pipeline
            logger.error(`❌ Finance module error (pipeline continues): ${finErr.message}`);
            financeData = null;
        }

        const { rate } = await exportToExcel(runDir, logger, financeData);

        const elapsed = ((performance.now() - start) / 1000).toFixed(1);

        logger.info("\n" + "=".repeat(60));
        logger.info("📊 PIPELINE SUMMARY");
        logger.info("=".repeat(60));
        logger.info(`   Status:      SUCCESS`);
        logger.info(`   Orders:      ${count}`);
        logger.info(`   Duration:    ${elapsed}s`);
        logger.info(`   Output:      ${runDir}`);
        logger.info("=".repeat(60));

        await writeMeta(runDir, {
            runDir,
            orders: count,
            duration: `${elapsed}s`,
            rate: String(rate),
            status: "success",
        });

        // Stage 5: Notify
        logger.info("\n--- STAGE 5: NOTIFYING ---");
        await notifySuccess({ runDir, count, elapsed, logger });

    } catch (err) {
        logger.error(`\n❌ PIPELINE CRITICAL ERROR: ${err.message}`);
        logger.error(err.stack);

        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
        await writeMeta(runDir, {
            runDir,
            orders: orderCount,
            duration: `${elapsed}s`,
            rate: "N/A",
            status: "failed",
            error: err.message,
        });

        // Best-effort failure alert — never throws
        try {
            await notifyFailure({ error: err, logger });
        } catch (notifyErr) {
            logger.warn(`⚠️  Could not send failure notification: ${notifyErr.message}`);
        }

        process.exit(1);
    } finally {
        logger.info("🏁 Pipeline finished");
        await logger.flush();
    }
}

async function writeMeta(runDir, meta) {
    const metaPath = path.join(runDir, "run-meta.json");
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
}

main().catch(console.error);