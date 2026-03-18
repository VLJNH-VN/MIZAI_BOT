const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function md5(s) {
  return crypto.createHash("md5").update(String(s)).digest("hex");
}

function looksLikeZaloImei(imei) {
  return typeof imei === "string" && imei.includes("-") && imei.split("-").pop()?.length === 32;
}

function generateImei(userAgent) {
  return `${crypto.randomUUID()}-${md5(userAgent)}`;
}

function persistImeiToConfig(imei) {
  try {
    const configPath = path.join(process.cwd(), "config.json");
    const current = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    current.imei = imei;
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2), "utf-8");
    return true;
  } catch (err) {
    logWarn(`Không thể ghi IMEI mới: ${err?.message || err}`);
    return false;
  }
}

function normalizeCookies(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw.cookies)) return raw.cookies;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    return raw.split(";").map((p) => p.trim()).filter(Boolean).map((kv) => {
      const idx = kv.indexOf("=");
      const key = idx >= 0 ? kv.slice(0, idx).trim() : kv.trim();
      const value = idx >= 0 ? kv.slice(idx + 1).trim() : "";
      return { key, value };
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => ({ key, value: String(value) }));
  }
  throw new Error("cookie.json không đúng định dạng");
}

module.exports = { looksLikeZaloImei, generateImei, persistImeiToConfig, normalizeCookies };
