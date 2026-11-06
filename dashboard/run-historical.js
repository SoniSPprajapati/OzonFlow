#!/usr/bin/env bun

import path from "path";
import { createLogger } from "../logger.js";
import { translateOrders } from "../02-translate.js";
import { generatePdfs } from "../03-generate.js";
import { exportToExcel } from "../04-excel.js";

async function run() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Run directory argument required");
    process.exit(1);
  }

  const logger = createLogger(runDir);

  logger.info("Executing historical report generation under Bun runtime...");

  // 1. Translate orders
  await translateOrders(runDir, logger);

  // 2. Generate PDFs
  await generatePdfs(runDir, logger);

  // 3. Export Excel
  const { rate } = await exportToExcel(runDir, logger);

  console.log(JSON.stringify({ status: "success", rate }));
}

run().catch((err) => {
  console.error("Historical generation error:", err);
  process.exit(1);
});
