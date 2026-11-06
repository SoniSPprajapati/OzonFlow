import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "executionTime" },
    });
    return NextResponse.json({
      executionTime: setting?.value || "10:30",
    });
  } catch (error: any) {
    return NextResponse.json({ executionTime: "10:30" });
  }
}

export async function POST(req: Request) {
  try {
    const { executionTime } = await req.json();
    if (!executionTime || !/^\d{2}:\d{2}$/.test(executionTime)) {
      return NextResponse.json({ error: "Invalid time format (HH:MM required)" }, { status: 400 });
    }

    const updated = await prisma.systemSetting.upsert({
      where: { key: "executionTime" },
      update: { value: executionTime },
      create: { key: "executionTime", value: executionTime },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
