import { NextResponse } from "next/server";
import { generateHistoricalReport } from "@/lib/historical";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { accountId, orders } = body;

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json(
        { error: "No orders selected for generation" },
        { status: 400 }
      );
    }

    const result = await generateHistoricalReport({
      accountId,
      orders,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
