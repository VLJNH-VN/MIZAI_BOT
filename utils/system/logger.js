"use strict";

// ── ANSI colors ───────────────────────────────────────────────────────────────
const C = {
  reset:      "\x1b[0m",
  bold:       "\x1b[1m",
  dim:        "\x1b[2m",
  // Info — xanh lá sáng
  infoIcon:   "\x1b[38;5;82m",
  infoText:   "\x1b[97m",
  // Warn — vàng cam
  warnIcon:   "\x1b[38;5;214m",
  warnText:   "\x1b[38;5;229m",
  // Error — đỏ
  errIcon:    "\x1b[38;5;196m",
  errText:    "\x1b[38;5;203m",
  errStack:   "\x1b[38;5;240m",
  // Event — tím xanh
  evtIcon:    "\x1b[38;5;141m",
  evtText:    "\x1b[38;5;189m",
  // Debug — xám
  dbgText:    "\x1b[38;5;244m",
};

// ── Format Error với stack trace gọn ─────────────────────────────────────────
function formatError(err) {
  if (!err) return "";
  const lines = [];
  const msg = err.message || String(err);
  lines.push(`${C.errText}${C.bold}${err.name || "Error"}: ${msg}${C.reset}`);
  if (err.stack) {
    const stackLines = err.stack
      .split("\n")
      .slice(1)
      .filter(l => l.trim().startsWith("at "))
      .slice(0, 5)
      .map(l => `${C.errStack}    ${l.trim()}${C.reset}`);
    if (stackLines.length) lines.push(...stackLines);
  }
  if (err.code)   lines.push(`${C.errStack}    code: ${err.code}${C.reset}`);
  if (err.status) lines.push(`${C.errStack}    status: ${err.status}${C.reset}`);
  return "\n" + lines.join("\n");
}

// ── Tách Error từ args ────────────────────────────────────────────────────────
function parseMessage(message, meta) {
  if (message instanceof Error) {
    return { text: message.message, err: message, extra: meta };
  }
  if (typeof message === "object" && message !== null) {
    try { return { text: JSON.stringify(message), err: null, extra: meta }; }
    catch { return { text: String(message), err: null, extra: meta }; }
  }
  const errInMeta = meta.find(m => m instanceof Error);
  return {
    text:  String(message),
    err:   errInMeta || null,
    extra: meta.filter(m => !(m instanceof Error))
  };
}

function formatMeta(meta) {
  if (!meta || meta.length === 0) return "";
  return " " + meta.map(m => {
    if (m === null || m === undefined) return String(m);
    if (m instanceof Error) return formatError(m);
    if (typeof m === "object") { try { return JSON.stringify(m); } catch { return String(m); } }
    return String(m);
  }).join(" ");
}

// ── Loggers ───────────────────────────────────────────────────────────────────
function logInfo(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);
  const line = `${C.infoIcon}✓${C.reset} ${C.infoText}${text}${C.reset}${formatMeta(extra)}`;
  console.log(err ? line + formatError(err) : line);
}

function logWarn(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);
  const line = `${C.warnIcon}⚠${C.reset} ${C.warnText}${text}${C.reset}${formatMeta(extra)}`;
  console.warn(err ? line + formatError(err) : line);
}

function logError(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);

  if (err) {
    console.error(`${C.errIcon}✗${C.reset} ${C.errText}${text}${C.reset}${formatMeta(extra)}${formatError(err)}`);
    return;
  }

  if (text.includes("\n")) {
    const [first, ...rest] = text.split("\n");
    const indented = rest.filter(Boolean).map(l => `${C.errStack}    ${l}${C.reset}`).join("\n");
    const line = `${C.errIcon}✗${C.reset} ${C.errText}${first}${C.reset}${formatMeta(extra)}`;
    console.error(indented ? line + "\n" + indented : line);
    return;
  }

  console.error(`${C.errIcon}✗${C.reset} ${C.errText}${text}${C.reset}${formatMeta(extra)}`);
}

function logEvent(message, ...meta) {
  const { text, err, extra } = parseMessage(message, meta);
  const line = `${C.evtIcon}◉${C.reset} ${C.evtText}${text}${C.reset}${formatMeta(extra)}`;
  console.log(err ? line + formatError(err) : line);
}

function logDebug(message, ...meta) {
  if (process.env.DEBUG !== "1") return;
  const { text, extra } = parseMessage(message, meta);
  console.log(`${C.dbgText}▸ ${text}${formatMeta(extra)}${C.reset}`);
}

module.exports = { logInfo, logWarn, logError, logEvent, logDebug };
