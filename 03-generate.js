#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import Handlebars from "handlebars";
import { PDFDocument } from "pdf-lib";
import { CONFIG } from "./config.js";

export async function generatePdfs(runDir, logger) {
  const inputFile = path.join(runDir, CONFIG.filenames.translated);
  const outputDir = path.join(runDir, CONFIG.filenames.renderDir);
  const finalPdfPath = path.join(runDir, CONFIG.filenames.finalPdf);
  const templatePath = path.join(process.cwd(), "template.html");

  await mkdir(outputDir, { recursive: true });

  function registerHelpers() {
    Handlebars.registerHelper("formatDate", (isoString) => {
      if (!isoString) return "-";
      const d = new Date(isoString);
      if (isNaN(d)) return "-";
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const mo = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
      const yyyy = d.getUTCFullYear();
      return `${dd} ${mo} ${yyyy}`;
    });

    Handlebars.registerHelper("formatWeight", (weight, unit) => {
      if (weight == null) return "-";
      const kg = unit === "g" ? weight / 1000 : weight;
      return kg.toFixed(3) + " kg";
    });

    Handlebars.registerHelper("findById", function (arr, id) {
      return Array.isArray(arr)
        ? arr.find((x) => x.product_id === id)
        : undefined;
    });

    Handlebars.registerHelper("totalWeight", (products) => {
      if (!Array.isArray(products)) return "-";
      const kg = products.reduce((sum, p) => {
        const w = p.dimensions?.weight || 0;
        const unit = p.dimensions?.weight_unit;
        return sum + (unit === "g" ? w / 1000 : w);
      }, 0);
      return kg.toFixed(3) + " kg";
    });

    Handlebars.registerHelper("eq", (a, b) => a === b);
    Handlebars.registerHelper("gt", (a, b) => a > b);
  }

  async function mergePdfs(pdfPaths, outputPath) {
    const merged = await PDFDocument.create();

    const pdfBuffers = await Promise.all(
      pdfPaths.map((filePath) => Bun.file(filePath).arrayBuffer())
    );

    for (const bytes of pdfBuffers) {
      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    const mergedBytes = await merged.save();
    await Bun.write(outputPath, mergedBytes);
  }

  async function renderOrder(browser, template, order) {
    if (order.financial_data?.products && order.products) {
      const skuToFinancial = {};

      for (const fp of order.financial_data.products) {
        skuToFinancial[fp.product_id] = fp;
      }

      order.financial_data.products = order.products
        .map((p) => {
          const fin = skuToFinancial[p.sku];
          if (fin) return { ...fin, product_id: p.product_id };
          return null;
        })
        .filter(Boolean);
    }

    const html = template(order);
    const page = await browser.newPage();

    try {
      page.setDefaultNavigationTimeout(10000);
      page.setDefaultTimeout(10000);

      await page.setContent(html, { waitUntil: "domcontentloaded" });

      // Image loading with 3s safety timeout
      await Promise.race([
        page.evaluate(() =>
          Promise.all(
            Array.from(document.images)
              .filter((img) => !img.complete)
              .map(
                (img) =>
                  new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                  }),
              ),
          ),
        ),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      const filePath = path.join(outputDir, `${order.posting_number}.pdf`);

      await page.pdf({
        path: filePath,
        format: "A4",
        printBackground: true,
        margin: {
          top: "10mm",
          bottom: "10mm",
          left: "10mm",
          right: "10mm",
        },
      });

      return { ok: true, file: filePath };
    } finally {
      await page.close();
    }
  }

  const inputBunFile = Bun.file(inputFile);
  if (!(await inputBunFile.exists())) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const dataArray = await inputBunFile.json();

  const templateSource = await Bun.file(templatePath).text();
  registerHelpers();
  const template = Handlebars.compile(templateSource);

  logger.info("🚀 Launching browser...");

  // ✅ SMART CHROME LAUNCH (AUTO + FALLBACK)
  let browser;

  const candidatePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  const fs = await import("fs");
  let systemChromePath = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      systemChromePath = p;
      break;
    }
  }

  if (systemChromePath) {
    try {
      logger.info(`🚀 Launching system Chrome at ${systemChromePath}...`);
      browser = await puppeteer.launch({
        headless: true,
        executablePath: systemChromePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
    } catch (err) {
      logger.warn(`⚠️ System Chrome failed (${err.message}), using Puppeteer default...`);
    }
  }

  if (!browser) {
    logger.info("🚀 Launching Puppeteer bundled browser...");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  }

  const ok = [];

  try {
    const CONCURRENCY = 15;

    for (let i = 0; i < dataArray.length; i += CONCURRENCY) {
      const batch = dataArray.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (order) => {
          try {
            const result = await renderOrder(browser, template, order);
            ok.push(result);
            logger.debug(`✅ Generated PDF for ${order.posting_number}`);
          } catch (err) {
            logger.error(
              `❌ Failed PDF for ${order.posting_number}: ${err.message}`,
            );
          }
        }),
      );
    }
  } finally {
    await browser.close();
  }

  if (ok.length > 0) {
    const orderedPaths = dataArray
      .map((order) =>
        ok.find((r) => path.basename(r.file) === `${order.posting_number}.pdf`),
      )
      .filter(Boolean)
      .map((r) => r.file);

    await mergePdfs(orderedPaths, finalPdfPath);
    logger.info(`📄 Final PDF created: ${finalPdfPath}`);
  }

  logger.info(`⚡ Done — ${ok.length}/${dataArray.length} PDFs generated.`);
}
