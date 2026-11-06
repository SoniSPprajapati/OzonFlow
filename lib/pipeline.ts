import { spawn } from "child_process";
import path from "path";
import { readdir, readFile, stat } from "fs/promises";
import { prisma } from "./prisma";

export async function runPipelineForAccount(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error(`Account with ID "${accountId}" not found`);
  }

  if (!account.isEnabled) {
    throw new Error(`Account "${account.name}" is currently disabled`);
  }

  // Record initial run in database
  const runRecord = await prisma.pipelineRun.create({
    data: {
      accountId: account.id,
      accountName: account.name,
      status: "running",
      runDir: "pending",
      startedAt: new Date(),
    },
  });

  const env = {
    ...process.env,
    OZON_CLIENT_ID: account.clientId,
    OZON_API_KEY: account.apiKey,
    ACCOUNT_LABEL: account.name,
  };

  const mainScriptPath = path.join(process.cwd(), "main.js");
  const runsDir = path.join(process.cwd(), "runs");

  return new Promise((resolve, reject) => {
    // stdio ignore for stdout to prevent console IPC buffer backpressure for 100% native speed
    const child = spawn("bun", [mainScriptPath], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", async (code) => {
      const completedAt = new Date();
      
      // Locate the newest run directory created by main.js in runs/
      const runDir = await getLatestRunDirectory(runsDir);

      let status = code === 0 ? "completed" : "failed";
      let orderCount = 0;
      let duration = "";
      let pdfPath: string | null = null;
      let excelPath: string | null = null;
      let errorMsg: string | null = code !== 0 ? stderr : null;

      if (runDir) {
        try {
          const metaPath = path.join(runDir, "run-meta.json");
          if (await fileExists(metaPath)) {
            const metaContent = await readFile(metaPath, "utf-8");
            const meta = JSON.parse(metaContent);
            
            orderCount = typeof meta.orders === "number" ? meta.orders : 0;
            duration = meta.duration || "";

            if (meta.status === "skipped") {
              status = "skipped";
            } else if (meta.status === "failed") {
              status = "failed";
              errorMsg = meta.error || errorMsg;
            } else if (meta.status === "success") {
              status = "completed";
            }

            const pdfFile = path.join(runDir, "final.pdf");
            const excelFile = path.join(runDir, "03_report.xlsx");

            pdfPath = (await fileExists(pdfFile)) ? pdfFile : null;
            excelPath = (await fileExists(excelFile)) ? excelFile : null;
          }
        } catch (e) {
          // fallback if meta file parse fails
        }
      }

      const updated = await prisma.pipelineRun.update({
        where: { id: runRecord.id },
        data: {
          status,
          orderCount,
          duration,
          runDir: runDir || "N/A",
          pdfPath,
          excelPath,
          error: errorMsg,
          completedAt,
        },
      });

      resolve(updated);
    });

    child.on("error", async (err) => {
      const updated = await prisma.pipelineRun.update({
        where: { id: runRecord.id },
        data: {
          status: "failed",
          error: err.message,
          completedAt: new Date(),
        },
      });
      reject(err);
    });
  });
}

export async function syncPastRuns() {
  const runsDir = path.join(process.cwd(), "runs");
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith("_run")) {
        const dirPath = path.join(runsDir, entry.name);
        const metaPath = path.join(dirPath, "run-meta.json");

        if (await fileExists(metaPath)) {
          try {
            const metaContent = await readFile(metaPath, "utf-8");
            const meta = JSON.parse(metaContent);

            const pdfFile = path.join(dirPath, "final.pdf");
            const excelFile = path.join(dirPath, "03_report.xlsx");

            const pdfPath = (await fileExists(pdfFile)) ? pdfFile : null;
            const excelPath = (await fileExists(excelFile)) ? excelFile : null;

            // Check if already in DB
            const existing = await prisma.pipelineRun.findFirst({
              where: { runDir: dirPath },
            });

            if (!existing) {
              const runDate = parseDateFromRunName(entry.name);
              const defaultAccount = await prisma.account.findFirst({ where: { isEnabled: true } });
              const defaultName = defaultAccount?.name || process.env.ACCOUNT_LABEL || "Frostrek LLP";

              await prisma.pipelineRun.create({
                data: {
                  accountId: defaultAccount?.id || null,
                  accountName: defaultName,
                  status: meta.status === "success" ? "completed" : meta.status || "completed",
                  orderCount: meta.orders || 0,
                  duration: meta.duration || "N/A",
                  runDir: dirPath,
                  pdfPath,
                  excelPath,
                  startedAt: runDate,
                  completedAt: runDate,
                },
              });
            }
          } catch (err) {
            // Ignore corrupted run meta files
          }
        }
      }
    }
  } catch (err) {
    // runs directory might not exist yet
  }
}

async function getLatestRunDirectory(runsDir: string): Promise<string | null> {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const runDirs: { name: string; path: string; mtime: number }[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith("_run")) {
        const fullPath = path.join(runsDir, entry.name);
        try {
          const s = await stat(fullPath);
          runDirs.push({ name: entry.name, path: fullPath, mtime: s.mtimeMs });
        } catch {}
      }
    }

    if (runDirs.length === 0) return null;
    runDirs.sort((a, b) => b.mtime - a.mtime);
    return runDirs[0].path;
  } catch {
    return null;
  }
}

function parseDateFromRunName(dirName: string): Date {
  const match = dirName.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})_run$/);
  if (match) {
    const [_, datePart, hour, min] = match;
    return new Date(`${datePart}T${hour}:${min}:00Z`);
  }
  return new Date();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
