import { prisma } from "./prisma";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import https from "https";

// ---------------------------------------------------------------------------
// fetchWithRetry — wraps native Node https.request with exponential backoff.
// Bypasses Next.js undici fetch which hangs on some networks due to IPv6/TLS issues.
// ---------------------------------------------------------------------------
async function fetchWithRetry(
  urlStr: string,
  options: any,
  maxAttempts = 5,
  baseDelayMs = 1500
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await new Promise<any>((resolve, reject) => {
        const url = new URL(urlStr);
        const req = https.request(
          url,
          {
            method: options.method,
            headers: options.headers,
            timeout: 60000,
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => {
              const ok = response.statusCode && response.statusCode >= 200 && response.statusCode < 300;
              resolve({
                ok,
                status: response.statusCode,
                headers: response.headers,
                text: async () => body,
                json: async () => {
                  try {
                    return JSON.parse(body);
                  } catch {
                    return null;
                  }
                },
              });
            });
          }
        );

        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("TimeoutError"));
        });

        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });

      // Retry on 429 (rate limit) or 5xx server errors (not caller auth/format errors like 400, 401, 403)
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        let delayMs = baseDelayMs * 2 ** (attempt - 1);
        if (res.status === 429) {
          const retryAfter = res.headers?.["retry-after"];
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed) && parsed > 0) {
              delayMs = Math.max(delayMs, parsed * 1000);
            }
          } else {
            delayMs = Math.max(delayMs, 1500 * attempt);
          }
        }
        console.warn(
          `[historical] Ozon API returned ${res.status} (${res.status === 429 ? "Rate Limit" : "Server Error"}) on attempt ${attempt}/${maxAttempts}. Retrying in ${delayMs}ms…`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(
          `[historical] fetch error on attempt ${attempt}/${maxAttempts}: ${err?.message ?? err}. Retrying…`
        );
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

export interface FetchHistoricalParams {
  accountId: string;
  fromDate: string;
  toDate: string;
  statuses: string[];
  executionTime?: string;
  startPostingNumber?: string;
  endPostingNumber?: string;
}

export async function fetchHistoricalOrders({
  accountId,
  fromDate,
  toDate,
  statuses,
  executionTime = "10:30",
  startPostingNumber,
  endPostingNumber,
}: FetchHistoricalParams) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error("Account not found");
  }

  const BASE_URL = "https://api-seller.ozon.ru";
  const HEADERS = {
    "Client-Id": account.clientId,
    "Api-Key": account.apiKey,
    "Content-Type": "application/json",
  };

  // STRICT IST date window — never expanded, never overridden
  const sinceIso = new Date(`${fromDate}T${executionTime}:00+05:30`).toISOString();
  const toIso = new Date(`${toDate}T${executionTime}:00+05:30`).toISOString();

  const allPostings: any[] = [];

  // When posting number range is active, fetch ALL statuses to ensure
  // no orders are missed — the range filter is the primary constraint.
  // Otherwise, use only the user-selected statuses.
  const ALL_STATUSES = [
    "awaiting_packaging",
    "awaiting_deliver",
    "delivering",
    "delivered",
    "cancelled",
  ];

  const targetStatuses = (startPostingNumber && endPostingNumber)
    ? ALL_STATUSES
    : (statuses.length > 0 ? statuses : ALL_STATUSES);

  let cursor = "";
  let pageCount = 0;
  const PAGE_SIZE = 100;

  while (true) {
    if (pageCount > 0) {
      await new Promise((r) => setTimeout(r, 600));
    }
    pageCount++;

    const res = await fetchWithRetry(
      `${BASE_URL}/v4/posting/fbs/list`,
      {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          filter: {
            since: sinceIso,
            to: toIso,
            statuses: targetStatuses,
          },
          limit: PAGE_SIZE,
          with: {
            analytics_data: true,
            barcodes: true,
            financial_data: true,
          },
          cursor: cursor || undefined,
        }),
      },
      5,    // max 5 attempts
      1500  // 1.5s base backoff
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ozon API Error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const postings = data?.postings || [];

    if (postings.length === 0) break;

    allPostings.push(...postings);

    if (!data?.has_next || !data?.cursor) break;
    cursor = data.cursor;
  }

  // Deduplicate by posting_number (multiple statuses may return the same order)
  const seen = new Set<string>();
  const uniquePostings = allPostings.filter((p) => {
    const pn = p.posting_number;
    if (seen.has(pn)) return false;
    seen.add(pn);
    return true;
  });

  // Sort by Ozon's natural sequence: in_process_at timestamp (ascending)
  // This preserves the exact order you see in the Ozon seller dashboard.
  uniquePostings.sort((a, b) => {
    const aTime = new Date(a.in_process_at || 0).getTime();
    const bTime = new Date(b.in_process_at || 0).getTime();
    return aTime - bTime;
  });

  // Apply posting number range by finding exact boundary matches in the sequence,
  // then slicing between them (inclusive). No lexicographic comparison.
  let filteredPostings = uniquePostings;
  if (startPostingNumber && endPostingNumber) {
    const startIdx = uniquePostings.findIndex((p) => p.posting_number === startPostingNumber);
    const endIdx = uniquePostings.findIndex((p) => p.posting_number === endPostingNumber);

    if (startIdx === -1 && endIdx === -1) {
      // Neither boundary found — return all orders so user can see what's available
      filteredPostings = uniquePostings;
    } else if (startIdx !== -1 && endIdx !== -1) {
      // Both found — slice between the lower and higher index (inclusive)
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      filteredPostings = uniquePostings.slice(lo, hi + 1);
    } else {
      // Only one boundary found — slice from/to that point
      const foundIdx = startIdx !== -1 ? startIdx : endIdx;
      filteredPostings = uniquePostings.slice(foundIdx);
    }
  }

  return formatHistoricalOrders(filteredPostings);
}

function formatHistoricalOrders(postings: any[]) {
  const mapProduct = (item: any) => ({
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    mandatory_mark: item.mandatory_mark || [],
    currency_code: item.currency_code || "RUB",
    // Required by PDF template for product image rendering (template.html line 538-542)
    primary_image: item.primary_image || null,
    // Required by PDF template for financial_data lookup and article display
    offer_id: item.offer_id || null,
    product_id: item.product_id || null,
    // Required by PDF template for weight/dimensions display
    dimensions: item.dimensions || null,
  });

  return postings.map((p) => ({
    posting_number: p.posting_number,
    status: p.status,
    in_process_at: p.in_process_at,
    shipment_date: p.shipment_date,
    customer: {
      name: p.customer?.name || p.addressee?.name || "Ozon Customer",
      customer_email: p.customer?.customer_email || "",
      customer_id: p.customer?.customer_id || "",
      address: p.customer?.address || p.addressee?.address || {},
    },
    delivery_method: {
      id: p.delivery_method?.id,
      name: p.delivery_method?.name,
      warehouse: p.delivery_method?.warehouse,
      tpl_provider: p.delivery_method?.tpl_provider,
    },
    products: (p.products || []).map(mapProduct),
    financial_data: p.financial_data || {},
  }));
}

export async function generateHistoricalReport({
  accountId,
  orders,
}: {
  accountId: string;
  orders: any[];
}) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error("Account not found");
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  const folderName = `historical_${year}-${month}-${day}_${hours}-${minutes}_run`;
  const runDir = path.join(process.cwd(), "runs", folderName);

  const runnerScript = path.join(process.cwd(), "dashboard", "run-historical.js");

  // Create the run directory and write orders to the raw data file
  // instead of passing them as a CLI argument (which causes ENAMETOOLONG on large order sets)
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "01_data_raw.json"),
    JSON.stringify(orders, null, 2)
  );

  return new Promise((resolve, reject) => {
    const bunProcess = spawn(
      "bun",
      [runnerScript, runDir],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ACCOUNT_LABEL: account.name,
          OZON_CLIENT_ID: account.clientId,
          OZON_API_KEY: account.apiKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    bunProcess.stdout.on("data", (c) => (stdout += c.toString()));
    bunProcess.stderr.on("data", (c) => (stderr += c.toString()));

    bunProcess.on("close", async (code) => {
      if (code !== 0) {
        return reject(
          new Error(`Historical generation process failed (code ${code}): ${stderr || stdout}`)
        );
      }

      const pdfPath = path.join(runDir, "final.pdf");
      const excelPath = path.join(runDir, "03_report.xlsx");

      // Record in database
      const runRecord = await prisma.pipelineRun.create({
        data: {
          accountId: account.id,
          accountName: account.name,
          status: "completed",
          orderCount: orders.length,
          duration: "N/A",
          runDir: runDir,
          pdfPath,
          excelPath,
          startedAt: now,
          completedAt: new Date(),
        },
      });

      resolve({
        runId: runRecord.id,
        runDir,
        pdfPath,
        excelPath,
        orderCount: orders.length,
      });
    });

    bunProcess.on("error", (err) => {
      reject(err);
    });
  });
}
