const colors = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m"
};

function formatMeta(meta) {
  if (!meta || meta.length === 0) return "";
  return " " + meta.map((m) => {
    if (m === null || m === undefined) return String(m);
    if (m instanceof Error) return m.stack || m.message;
    if (typeof m === "object") {
      try { return JSON.stringify(m); } catch { return String(m); }
    }
    return String(m);
  }).join(" ");
}

function logInfo(message, ...meta) {
  console.log(`${colors.green}[INFO]${colors.reset} ${message}${formatMeta(meta)}`);
}

function logWarn(message, ...meta) {
  console.warn(`${colors.yellow}[WARN]${colors.reset} ${message}${formatMeta(meta)}`);
}

function logError(message, ...meta) {
  console.error(`${colors.red}[ERROR]${colors.reset} ${message}${formatMeta(meta)}`);
}

function logEvent(message, ...meta) {
  console.log(`${colors.cyan}[EVENT]${colors.reset} ${message}${formatMeta(meta)}`);
}

function logDebug(message, ...meta) {
  if (process.env.DEBUG !== "1") return;
  console.log(`${colors.dim}[DEBUG]${colors.reset} ${message}${formatMeta(meta)}`);
}

module.exports = { logInfo, logWarn, logError, logEvent, logDebug };
