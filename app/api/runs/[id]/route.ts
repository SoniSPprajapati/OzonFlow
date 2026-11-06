import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import path from "path";
import { readFile, stat, rm } from "fs/promises";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await prisma.pipelineRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    let postings: any[] = [];
    let logContent = "";

    if (run.runDir && run.runDir !== "N/A" && run.runDir !== "pending") {
      // 1. Read postings from 01_data_raw.json or 02_data_translated.json
      const rawFile = path.join(run.runDir, "01_data_raw.json");
      const transFile = path.join(run.runDir, "02_data_translated.json");
      
      try {
        if (await fileExists(transFile)) {
          const content = await readFile(transFile, "utf-8");
          postings = JSON.parse(content);
        } else if (await fileExists(rawFile)) {
          const content = await readFile(rawFile, "utf-8");
          postings = JSON.parse(content);
        }
      } catch (e) {}

      // 2. Read log file
      const logFile = path.join(run.runDir, "pipeline.log");
      try {
        if (await fileExists(logFile)) {
          logContent = await readFile(logFile, "utf-8");
        }
      } catch (e) {}
    }

    return NextResponse.json({
      run,
      postingsCount: postings.length || run.orderCount,
      postings: postings.map((p) => ({
        postingNumber: p.posting_number,
        status: p.status,
        customerName: p.customer?.name || "N/A",
        productsCount: p.products?.length || 0,
        products: p.products?.map((prod: any) => prod.name).join(", ") || "-",
      })),
      logContent: logContent || run.error || "No log entries captured for this run.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await prisma.pipelineRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Remove directory on disk
    if (run.runDir && run.runDir !== "N/A" && run.runDir !== "pending") {
      try {
        await rm(run.runDir, { recursive: true, force: true });
      } catch (e) {}
    }

    // Delete DB record
    await prisma.pipelineRun.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
