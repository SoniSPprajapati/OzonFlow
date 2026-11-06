import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://api-seller.ozon.ru/v3/posting/fbs/list", {
      method: "POST",
      headers: {
        "Client-Id": "123",
        "Api-Key": "123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dir: "asc",
        filter: {
          since: new Date().toISOString(),
          to: new Date().toISOString(),
          status: "delivered",
        },
        limit: 10,
        offset: 0,
      }),
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json({ success: true, text });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      cause: error.cause ? String(error.cause) : undefined,
    });
  }
}
