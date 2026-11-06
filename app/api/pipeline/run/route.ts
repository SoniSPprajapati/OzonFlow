import { NextResponse } from "next/server";
import { runPipelineForAccount } from "@/lib/pipeline";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { accountId } = body;

    if (!accountId) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    const result = await runPipelineForAccount(accountId);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
