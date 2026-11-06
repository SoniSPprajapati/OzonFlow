import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { spawn } from "child_process";
import path from "path";

/**
 * POST /api/finance
 *
 * Triggers a standalone Finance fetch for a given account.
 * Runs ozon-finance.js directly via bun — does NOT touch the main pipeline.
 *
 * Body: { accountId: string, runDir?: string, daysBack?: number }
 *
 * If runDir is omitted, creates a new dedicated finance run directory.
 * If runDir is provided (e.g. from a completed pipeline run), appends finance
 * data into that existing run directory.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { accountId, runDir: providedRunDir, daysBack } = body;

    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      return NextResponse.json({ error: `Account "${accountId}" not found` }, { status: 404 });
    }

    if (!account.isEnabled) {
      return NextResponse.json({ error: `Account "${account.name}" is disabled` }, { status: 403 });
    }

    // Determine run directory — use provided one or create a new finance-only dir
    let targetRunDir: string;

    if (providedRunDir) {
      targetRunDir = providedRunDir;
    } else {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 16).replace("T", "_");
      targetRunDir = path.join(process.cwd(), "runs", `${timestamp}_finance`);

      // Ensure the directory exists
      const { mkdir } = await import("fs/promises");
      await mkdir(targetRunDir, { recursive: true });
    }

    // Build a tiny inline script that imports and calls fetchFinanceData,
    // then saves results to the run directory using the account's credentials.
    // This keeps the Finance module truly standalone and reusable.
    const inlineScript = `
import { fetchFinanceData } from "${path.join(process.cwd(), "ozon-finance.js").replace(/\\/g, "/")}";
import { createLogger } from "${path.join(process.cwd(), "logger.js").replace(/\\/g, "/")}";

const runDir = ${JSON.stringify(targetRunDir)};
const logger = createLogger(runDir);

try {
  const result = await fetchFinanceData(runDir, logger);
  logger.info("Finance API run complete: " + result.transactions.length + " transactions");
  await logger.flush();
  process.exit(0);
} catch (err) {
  logger.error("Finance API run failed: " + err.message);
  await logger.flush();
  process.exit(1);
}
`;

    const env = {
      ...process.env,
      OZON_CLIENT_ID: account.clientId,
      OZON_API_KEY: account.apiKey,
      ACCOUNT_LABEL: account.name,
      ...(daysBack ? { FINANCE_DAYS_BACK: String(daysBack) } : {}),
    };

    await new Promise<void>((resolve, reject) => {
      const child = spawn("bun", ["--eval", inlineScript], {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", "ignore", "pipe"],
      });

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on("close", (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Finance fetch exited with code ${code}: ${stderr.slice(0, 400)}`));
        }
      });

      child.on("error", reject);
    });

    return NextResponse.json({
      success: true,
      account: account.name,
      runDir: targetRunDir,
      message: "Finance data fetched successfully. Check 01_finance_raw.json in the run directory.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
