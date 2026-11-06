import { NextResponse } from "next/server";
import path from "path";
import { readFile, stat } from "fs/promises";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "Missing file path" }, { status: 400 });
  }

  // Security check: ensure path is within workspace
  const normalized = path.normalize(filePath);
  const runsDir = path.normalize(path.join(process.cwd(), "runs"));

  if (!normalized.startsWith(runsDir)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    try {
      await stat(normalized);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const filename = path.basename(normalized);
    const contentType = filename.endsWith(".pdf")
      ? "application/pdf"
      : filename.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/octet-stream";

    const buffer = await readFile(normalized);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
