"use strict";

// ── ANSI colors ───────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  gray:    "\x1b[90m",
  redBold: "\x1b[1;31m",
};

// ── Timestamp HH:MM:SS ────────────────────────────────────────────────────────
function ts() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${C.gray}[${h}:${m}:${s}]${C.reset}`;
}

// ── Format extra meta args ────────────────────────────────────────────────────
function formatMeta(meta) {
  if (!meta || meta.length === 0) return "";
  return " " + meta.map((m) => {
    if (m === null || m === undefined) return String(m);
    if (m instanceof Error) return formatError(m);
    if (typeof m === "object") {
      try { return JSON.stringify(m, null, 2); } catch { return String(m); }
    }
    return String(m);
  }).join(" ");
}

// ── Format Error với stack trace gọn ─────────────────────────────────────────
function formatError(err) {
  if (!err) return "";

  const lines = [];
  const msg = err.message || String(err);

  lines.push(`${C.redBold}${err.name || "Error"}: ${msg}${C.reset}`);

  if (err.stack) {
    const stackLines = err.stack
      .split("\n")
      .slice(1)
      .filter(l => l.trim().startsWith("at "))
      .slice(0, 6)
      .map(l => `${C.gray}    ${l.trim()}${C.reset}`);

    if (stackLines.length) lines.push(...stackLines);
  }

  if (err.code)   lines.push(`${C.gray}    code: ${err.code}${C.reset}`);
  if (err.status) lines.push(`${C.gray}    status: ${err.status}${C.reset}`);

  return "\n" + lines.join("\n");
}

// ── Tách Error từ message string hoặc object ─────────────────────────────────
function parseMessage(message, meta) {
  if (message instanceof Error) {
    return { text: message.message, err: message, extra: meta };
  }
  if (typeof message === "object" && message !== null) {
    try { return { text: JSON.stringify(message), err: null, extra: meta }; }
    catch { return { text: String(message), err: null, extra: meta }; }
  }
  const errInMeta = meta.find(m => m instanceof Error);
  return { text: String(message), err: errInMeta || null, extra: meta.filter(m => !(m instanceof Error)) };
}

// ── Loggers ───────────────────────────────────────────────────────────────────
function logInfo(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);
  const line = `${ts()} ${C.green}✓${C.reset} ${text}${formatMeta(extra)}`;
  console.log(err ? line + formatError(err) : line);
}

function logWarn(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);
  const line = `${ts()} ${C.yellow}⚠${C.reset} ${text}${formatMeta(extra)}`;
  console.warn(err ? line + formatError(err) : line);
}

function logError(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);

  let detail = "";

  if (err) {
    detail = formatError(err);
  } else if (text.includes("\n")) {
    const [first, ...rest] = text.split("\n");
    const indented = rest.filter(Boolean).map(l => `${C.gray}    ${l}${C.reset}`).join("\n");
    const shortLine = `${ts()} ${C.redBold}✗${C.reset} ${first}${formatMeta(extra)}`;
    console.error(indented ? shortLine + "\n" + indented : shortLine);
    return;
  }

  console.error(`${ts()} ${C.redBold}✗${C.reset} ${text}${formatMeta(extra)}${detail}`);
}

function logEvent(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);
  const line = `${ts()} ${C.cyan}◉${C.reset} ${text}${formatMeta(extra)}`;
  console.log(err ? line + formatError(err) : line);
}

function logDebug(message, ...meta) {
  if (process.env.DEBUG !== "1") return;
  const { text, extra } = parseMessage(message, meta);
  console.log(`${ts()} ${C.dim}▸ ${text}${formatMeta(extra)}${C.reset}`);
}

module.exports = { logInfo, logWarn, logError, logEvent, logDebug };
