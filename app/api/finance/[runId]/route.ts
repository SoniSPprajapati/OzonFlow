import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import path from "path";

/**
 * GET /api/finance/[runId]
 *
 * Returns the raw finance data (01_finance_raw.json) and totals
 * (01_finance_totals.json) for a given pipeline run.
 *
 * Query params:
 *   type = "raw" | "totals" | "summary"  (default: "summary")
 *
 * "summary" returns:  { account, fetched_at, total_count, date_from, date_to, totals }
 * "raw"     returns:  full 01_finance_raw.json contents
 * "totals"  returns:  full 01_finance_totals.json contents
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") ?? "summary";

    // Look up the run record to get the run directory
    const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });

    if (!run) {
      return NextResponse.json({ error: `Run "${runId}" not found` }, { status: 404 });
    }

    const runDir = run.runDir;

    if (!runDir || runDir === "N/A" || runDir === "pending") {
      return NextResponse.json(
        { error: "Run directory not available for this run" },
        { status: 404 }
      );
    }

    const rawPath = path.join(runDir, "01_finance_raw.json");
    const totalsPath = path.join(runDir, "01_finance_totals.json");

    // Helper: safely read a JSON file
    async function readJsonFile(filePath: string): Promise<any | null> {
      try {
        const content = await readFile(filePath, "utf-8");
        return JSON.parse(content);
      } catch {
        return null;
      }
    }

    if (type === "raw") {
      const data = await readJsonFile(rawPath);
      if (!data) {
        return NextResponse.json(
          { error: "Finance raw data not found. Run finance fetch for this account first." },
          { status: 404 }
        );
      }
      return NextResponse.json(data);
    }

    if (type === "totals") {
      const data = await readJsonFile(totalsPath);
      if (!data) {
        return NextResponse.json(
          { error: "Finance totals not found." },
          { status: 404 }
        );
      }
      return NextResponse.json(data);
    }

    // Default: "summary" — lightweight response without full transaction list
    const rawData = await readJsonFile(rawPath);
    const totalsData = await readJsonFile(totalsPath);

    if (!rawData) {
      return NextResponse.json(
        {
          runId,
          runDir,
          financeAvailable: false,
          message: "Finance data has not been fetched for this run yet.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      runId,
      runDir,
      financeAvailable: true,
      account: rawData.account,
      fetched_at: rawData.fetched_at,
      date_from: rawData.date_from,
      date_to: rawData.date_to,
      total_transaction_count: rawData.total_count,
      totals: totalsData?.totals ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
