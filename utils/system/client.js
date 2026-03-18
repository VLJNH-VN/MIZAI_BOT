const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Zalo } = require("zca-js");
const { imageSize } = require("image-size");
const QRCode = require("qrcode");

// ── IMEI & Cookie helpers ─────────────────────────────────────────────────────

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

// ── Zalo Client ───────────────────────────────────────────────────────────────

async function displayQRInTerminal(qrData) {
  try {
    const qrString = await QRCode.toString(qrData, { type: "terminal", small: true });
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║      QUÉT MÃ QR ĐỂ ĐĂNG NHẬP ZALO  ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(qrString);
    logInfo("[QR] Mở Zalo trên điện thoại → Cá nhân → Đăng nhập trên thiết bị khác → Quét mã.");
  } catch (err) {
    logWarn(`[QR] Không thể hiển thị QR trong terminal: ${err?.message}`);
  }
}

async function createZaloClient() {
  const config = global.config;
  const loginMethod = (config.loginMethod || "qr").toLowerCase();
  const userAgent = (config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").trim();

  const zalo = new Zalo({
    selfListen: true,
    checkUpdate: true,
    logging: true,
    imageMetadataGetter: async (filePath) => {
      const buf = await fs.promises.readFile(filePath);
      const dim = imageSize(buf);
      const stat = await fs.promises.stat(filePath);
      return { width: dim?.width, height: dim?.height, size: stat?.size ?? buf.length };
    }
  });

  if (loginMethod === "cookie") {
    const cookiePath = config.cookiePath || "./cookie.json";
    if (!fs.existsSync(cookiePath)) throw new Error(`Không tìm thấy file cookie: ${cookiePath}`);
    const cookieRaw = JSON.parse(fs.readFileSync(cookiePath, "utf-8"));
    const cookie = normalizeCookies(cookieRaw).map((c) => ({
      ...c,
      key:      c.key || c.name,
      value:    String(c.value),
      domain:   c.domain   || ".zalo.me",
      path:     c.path     || "/",
      secure:   c.secure   ?? true,
      httpOnly: c.httpOnly ?? true
    }));
    let imei = looksLikeZaloImei(config.imei) ? config.imei : generateImei(userAgent);
    if (!looksLikeZaloImei(config.imei)) { persistImeiToConfig(imei); config.imei = imei; }
    const api = await zalo.login({ cookie, imei, userAgent });
    logInfo("Đăng nhập Zalo bằng COOKIE thành công.");
    return api;
  }

  const qrPath = config.qrPath || "./qr.png";
  logInfo("[QR] Đang tạo mã QR để đăng nhập Zalo...");
  logInfo(`[QR] QR code sẽ được lưu tại: ${path.resolve(qrPath)}`);

  let _qrDisplayed = false;
  const api = await zalo.loginQR({
    userAgent,
    qrPath,
    onQR: async (qrData) => {
      if (qrData) { _qrDisplayed = true; await displayQRInTerminal(qrData); }
      else logInfo(`[QR] QR đã lưu tại: ${path.resolve(qrPath)} — hãy mở file để quét.`);
    }
  });

  if (!_qrDisplayed) {
    logInfo(`[QR] QR code đã lưu tại: ${path.resolve(qrPath)}`);
    logInfo("[QR] Hãy mở file qr.png và quét bằng ứng dụng Zalo trên điện thoại.");
  }

  logInfo("Đăng nhập Zalo bằng QR thành công.");
  return api;
}

module.exports = { createZaloClient, looksLikeZaloImei, generateImei, persistImeiToConfig, normalizeCookies };
