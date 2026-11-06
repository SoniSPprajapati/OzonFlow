import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncPastRuns } from "@/lib/pipeline";
import { rm } from "fs/promises";

export async function GET() {
  try {
    // Automatically sync runs from disk to database if missing
    await syncPastRuns();

    const runs = await prisma.pipelineRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 100,
    });

    return NextResponse.json(runs);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { ids, all } = body;

    if (all) {
      const runs = await prisma.pipelineRun.findMany();
      for (const run of runs) {
        if (run.runDir && run.runDir !== "N/A" && run.runDir !== "pending") {
          try {
            await rm(run.runDir, { recursive: true, force: true });
          } catch (e) {}
        }
      }
      await prisma.pipelineRun.deleteMany();
      return NextResponse.json({ success: true, message: "All history deleted" });
    }

    if (Array.isArray(ids) && ids.length > 0) {
      const runs = await prisma.pipelineRun.findMany({
        where: { id: { in: ids } },
      });

      for (const run of runs) {
        if (run.runDir && run.runDir !== "N/A" && run.runDir !== "pending") {
          try {
            await rm(run.runDir, { recursive: true, force: true });
          } catch (e) {}
        }
      }

      await prisma.pipelineRun.deleteMany({
        where: { id: { in: ids } },
      });

      return NextResponse.json({ success: true, count: ids.length });
    }

    return NextResponse.json({ error: "No IDs or 'all' flag provided" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
