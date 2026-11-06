#!/usr/bin/env bun

/**
 * 05-notify.js
 *
 * Sends pipeline results to a whitelist of Telegram users via a bot.
 *
 * On SUCCESS:    sends a summary message + uploads final.pdf + uploads 03_report.xlsx
 * On NO ORDERS: sends a notice so recipients know the pipeline ran but found nothing
 * On FAILURE:   sends an error alert with the failure reason
 *
 * Setup:
 *   1. Create a bot via @BotFather on Telegram → get TELEGRAM_BOT_TOKEN
 *   2. Each recipient must send /start to the bot first (one time only)
 *   3. Get their chat ID: https://api.telegram.org/bot<TOKEN>/getUpdates
 *   4. Add IDs to TELEGRAM_ALLOWED_CHAT_IDS in .env (comma-separated)
 *
 * Environment variables required:
 *   TELEGRAM_BOT_TOKEN        — from BotFather
 *   TELEGRAM_ALLOWED_CHAT_IDS — comma-separated list of allowed chat IDs
 *                               e.g. "123456789,987654321"
 *   ACCOUNT_LABEL             — display name shown in all messages
 */

const BASE_URL = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// ─── Whitelist ────────────────────────────────────────────────────────────────

function getAllowedChatIds() {
    const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS || "";
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

// ─── Core API helpers ─────────────────────────────────────────────────────────

async function telegramRequest(method, body) {
    const res = await fetch(`${BASE_URL()}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
    return data;
}

async function sendMessage(chatId, text) {
    return telegramRequest("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
    });
}

async function sendFile(chatId, filePath, caption) {
    const file = Bun.file(filePath);
    if (!(await file.exists())) throw new Error(`File not found: ${filePath}`);

    const filename = filePath.split("/").pop();
    const bytes = await file.arrayBuffer();

    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption || "");
    form.append("document", new Blob([bytes]), filename);

    const res = await fetch(`${BASE_URL()}/sendDocument`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram sendDocument failed: ${data.description}`);
    return data;
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────

async function broadcastMessage(chatIds, text, logger) {
    for (const chatId of chatIds) {
        try {
            await sendMessage(chatId, text);
        } catch (err) {
            logger.warn(`⚠️  Telegram message failed for ${chatId}: ${err.message}`);
        }
    }
}

async function broadcastFile(chatIds, filePath, caption, logger) {
    for (const chatId of chatIds) {
        try {
            await sendFile(chatId, filePath, caption);
        } catch (err) {
            logger.warn(`⚠️  Telegram file send failed for ${chatId}: ${err.message}`);
        }
    }
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export async function notifySuccess({ runDir, count, elapsed, logger }) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        logger.warn("⚠️  TELEGRAM_BOT_TOKEN not set — skipping notification.");
        return;
    }

    const chatIds = getAllowedChatIds();
    if (chatIds.length === 0) {
        logger.warn("⚠️  TELEGRAM_ALLOWED_CHAT_IDS not set — skipping notification.");
        return;
    }

    logger.info(`📨 Notifying ${chatIds.length} recipient(s) via Telegram...`);

    const label = process.env.ACCOUNT_LABEL || "Unknown Account";
    const now = new Date().toUTCString();
    const summaryText = [
        `✅ <b>Ozon Pipeline — Run Complete</b>`,
        `🏪 Account: <b>${label}</b>`,
        ``,
        `📦 Orders processed: <b>${count}</b>`,
        `⏱ Duration: <b>${elapsed}s</b>`,
        `🕐 Completed at: <b>${now}</b>`,
        ``,
        `Files attached below 👇`,
    ].join("\n");

    await broadcastMessage(chatIds, summaryText, logger);

    const pdfPath = `${runDir}/final.pdf`;
    const xlsxPath = `${runDir}/03_report.xlsx`;

    await broadcastFile(chatIds, pdfPath, `📄 Invoices — ${count} order(s)`, logger);
    await broadcastFile(chatIds, xlsxPath, `📊 Shipment report — ${count} order(s)`, logger);

    logger.info("✅ Telegram notifications sent.");
}

export async function notifyNoOrders({ logger }) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const chatIds = getAllowedChatIds();
    if (chatIds.length === 0) return;

    logger.info("📨 Sending no-orders notice via Telegram...");

    const label = process.env.ACCOUNT_LABEL || "Unknown Account";
    const now = new Date().toUTCString();
    const text = [
        `📭 <b>Ozon Pipeline — No Orders</b>`,
        `🏪 Account: <b>${label}</b>`,
        ``,
        `No orders with status <code>awaiting_packaging</code> were found.`,
        `🕐 Checked at: <b>${now}</b>`,
    ].join("\n");

    await broadcastMessage(chatIds, text, logger);
    logger.info("✅ No-orders notification sent.");
}

export async function notifyFailure({ error, logger }) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return; // silent — we're already in a failure state, don't add noise

    const chatIds = getAllowedChatIds();
    if (chatIds.length === 0) return;

    logger.info("📨 Sending failure alert via Telegram...");

    const label = process.env.ACCOUNT_LABEL || "Unknown Account";
    const now = new Date().toUTCString();
    const errorText = [
        `❌ <b>Ozon Pipeline — FAILED</b>`,
        `🏪 Account: <b>${label}</b>`,
        ``,
        `🕐 At: <b>${now}</b>`,
        `💥 Error: <code>${escapeHtml(error.message)}</code>`,
        ``,
        `Check GitHub Actions logs for the full stack trace.`,
    ].join("\n");

    await broadcastMessage(chatIds, errorText, logger);
    logger.info("✅ Failure alert sent.");
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}