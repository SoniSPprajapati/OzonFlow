import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    let accounts = await prisma.account.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Auto-seed default account from .env if table is empty
    if (accounts.length === 0 && process.env.OZON_CLIENT_ID && process.env.OZON_API_KEY) {
      const defaultAccount = await prisma.account.create({
        data: {
          name: process.env.ACCOUNT_LABEL || "Primary Account",
          clientId: process.env.OZON_CLIENT_ID.trim(),
          apiKey: process.env.OZON_API_KEY.trim(),
          isEnabled: true,
        },
      });
      accounts = [defaultAccount];
    }

    return NextResponse.json(accounts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, clientId, apiKey, isEnabled } = body;

    if (!name || !clientId || !apiKey) {
      return NextResponse.json(
        { error: "Account Name, Client ID, and API Key are required" },
        { status: 400 }
      );
    }

    const newAccount = await prisma.account.create({
      data: {
        name,
        clientId: clientId.trim(),
        apiKey: apiKey.trim(),
        isEnabled: isEnabled ?? true,
      },
    });

    return NextResponse.json(newAccount, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
