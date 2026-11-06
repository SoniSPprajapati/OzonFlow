import { NextResponse } from "next/server";
import { fetchHistoricalOrders } from "@/lib/historical";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { accountId, fromDate, toDate, statuses, executionTime, startPostingNumber, endPostingNumber } = body;

    if (!accountId || !fromDate || !toDate) {
      return NextResponse.json(
        { error: "Account, From Date, and To Date are required" },
        { status: 400 }
      );
    }

    let finalTime = executionTime;
    if (!finalTime) {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: "executionTime" },
      });
      finalTime = setting?.value || "10:30";
    }

    const orders = await fetchHistoricalOrders({
      accountId,
      fromDate,
      toDate,
      statuses: statuses || [],
      executionTime: finalTime,
      startPostingNumber: startPostingNumber || undefined,
      endPostingNumber: endPostingNumber || undefined,
    });

    return NextResponse.json({ orders });
  } catch (error: any) {
    const detail = {
      error: error.message,
      name: error.name,
      cause: error.cause ? String(error.cause) : undefined,
    };
    console.error("[historical/fetch] Error:", detail);
    return NextResponse.json(detail, { status: 500 });
  }
}
