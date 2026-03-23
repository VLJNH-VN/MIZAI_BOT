const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Zalo } = require("zca-js");
const { imageSize } = require("image-size");
const QRCode = require("qrcode");
let _sharp = null;
try { _sharp = require("sharp"); } catch {
  console.warn("[client] Module 'sharp' chưa được build — QR terminal display sẽ bị tắt.");
}
const jsQR = require("jsqr");

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
    if (global.config) global.config.imei = imei;
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

function cleanCookies(raw) {
  const arr = Array.isArray(raw) ? raw : (raw?.cookies || []);
  return arr.map(c => ({
    key:      c.key   || c.name  || "",
    value:    String(c.value ?? ""),
    domain:   c.domain || ".zalo.me",
    path:     c.path   || "/",
    secure:   c.secure   ?? true,
    httpOnly: c.httpOnly ?? true,
  })).filter(c => c.key && c.value);
}

function saveCookieFile(cookiePath, cookies) {
  try {
    const clean = cleanCookies(cookies);
    const cookieObj = {};
    for (const c of clean) {
      cookieObj[c.key] = c.value;
    }
    fs.writeFileSync(cookiePath, JSON.stringify(cookieObj, null, 2), "utf-8");
    logInfo(`[Cookie] Đã lưu ${clean.length} cookie vào ${path.resolve(cookiePath)}`);
  } catch (err) {
    logWarn(`[Cookie] Không thể lưu cookie: ${err?.message}`);
  }
}

// ── QR Display ────────────────────────────────────────────────────────────────

async function displayQRInTerminal(imageBase64) {
  try {
    if (!_sharp) {
      logWarn("[QR] sharp chưa build — không thể hiển thị QR trong terminal. Hãy mở file qr.png để quét.");
      return;
    }
    const buf = Buffer.from(imageBase64, "base64");
    const { data, info } = await _sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(data, info.width, info.height);
    const qrContent = decoded ? decoded.data : null;
    if (!qrContent) {
      logWarn("[QR] Không thể decode QR image, hãy mở file qr.png để quét.");
      return;
    }
    const qrString = await QRCode.toString(qrContent, {
      type: "terminal",
      small: true,
      margin: 1,
      errorCorrectionLevel: "L",
    });
    console.log("\n── QUÉT MÃ QR ĐỂ ĐĂNG NHẬP ZALO ──");
    console.log(qrString);
    logInfo("[QR] Zalo → Cá nhân → Đăng nhập trên thiết bị khác → Quét mã.");
  } catch (err) {
    logWarn(`[QR] Không thể hiển thị QR trong terminal: ${err?.message}`);
  }
}

// ── Login via QR ──────────────────────────────────────────────────────────────

async function loginWithQR(zalo, userAgent, cookiePath, qrPath, imei) {
  logInfo("[QR] Đang tạo mã QR để đăng nhập Zalo...");
  logInfo(`[QR] QR code sẽ được lưu tại: ${path.resolve(qrPath)}`);

  const api = await zalo.loginQR({ userAgent, qrPath }, async (event) => {
    const { type, data, actions } = event;
    if (type === 0) {
      await actions.saveToFile(qrPath);
      if (data && data.image) {
        await displayQRInTerminal(data.image);
      } else {
        logInfo(`[QR] QR đã lưu tại: ${path.resolve(qrPath)} — hãy mở file để quét.`);
      }
    } else if (type === 1) {
      logInfo("[QR] Mã QR đã hết hạn, đang tạo mã mới...");
      actions.retry();
    } else if (type === 2) {
      logInfo("[QR] Đã quét mã QR, đang chờ xác nhận trên điện thoại...");
    } else if (type === 3) {
      logWarn("[QR] Đăng nhập bị từ chối trên điện thoại.");
      actions.retry();
    } else if (type === 4) {
      if (data && data.cookie) {
        saveCookieFile(cookiePath, data.cookie);
        const cfg = global.config;
        const newImei = data.imei || imei;
        cfg.imei = newImei;
        persistImeiToConfig(newImei);
        logInfo("[Cookie] Cookie & IMEI đã lưu. Lần sau bot tự đăng nhập bằng cookie.");
      }
    }
  });

  logInfo("[QR] Đăng nhập bằng QR thành công.");
  return api;
}

// ── Login via Cookie ──────────────────────────────────────────────────────────

async function loginWithCookie(zalo, userAgent, cookiePath, imei) {
  const cookieRaw = JSON.parse(fs.readFileSync(cookiePath, "utf-8"));
  const normalized = normalizeCookies(cookieRaw);
  logInfo(`[Cookie] Đọc được ${normalized.length} cookie: ${normalized.map(c => c.key || c.name).join(", ")}`);
  const cookie = normalized.map((c) => ({
    ...c,
    key:      c.key || c.name,
    value:    String(c.value),
    domain:   c.domain   || ".zalo.me",
    path:     c.path     || "/",
    secure:   c.secure   ?? true,
    httpOnly: c.httpOnly ?? true
  }));
  try {
    const api = await zalo.login({ cookie, imei, userAgent });
    logInfo("Đăng nhập Zalo bằng COOKIE thành công.");
    return api;
  } catch (err) {
    const detail = {
      message: err?.message,
      code: err?.code,
      status: err?.response?.status,
      data: JSON.stringify(err?.response?.data)?.slice(0, 500),
    };
    logWarn(`[Cookie] Chi tiết lỗi: ${JSON.stringify(detail)}`);
    throw err;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function createZaloClient() {
  const config = global.config;
  const userAgent = (config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").trim();
  const cookiePath = config.cookiePath || "./cookie.json";
  const qrPath = config.qrPath || "./qr.png";

  let imei = looksLikeZaloImei(config.imei) ? config.imei : generateImei(userAgent);
  if (!looksLikeZaloImei(config.imei)) {
    persistImeiToConfig(imei);
    config.imei = imei;
  }

  const zalo = new Zalo({
    selfListen: true,
    checkUpdate: false,
    logging: false,
    imageMetadataGetter: async (filePath) => {
      const buf = await fs.promises.readFile(filePath);
      const dim = imageSize(buf);
      const stat = await fs.promises.stat(filePath);
      return { width: dim?.width, height: dim?.height, size: stat?.size ?? buf.length };
    }
  });

  // Thử đăng nhập bằng cookie trước
  if (fs.existsSync(cookiePath)) {
    try {
      logInfo("[Cookie] Đang thử đăng nhập bằng cookie...");
      const api = await loginWithCookie(zalo, userAgent, cookiePath, imei);
      return api;
    } catch (err) {
      logWarn(`[Cookie] Đăng nhập bằng cookie thất bại: ${err?.message || err}`);
      logWarn(`[Cookie] File cookie.json được giữ lại tại: ${path.resolve(cookiePath)}`);
      logInfo("[Cookie] Chuyển sang đăng nhập bằng QR...");
    }
  }

  // Fallback: đăng nhập QR với retry tối đa 3 lần
  const MAX_QR_RETRY = 3;
  for (let attempt = 1; attempt <= MAX_QR_RETRY; attempt++) {
    try {
      if (attempt > 1) {
        logInfo(`[QR] Thử lại lần ${attempt}/${MAX_QR_RETRY}...`);
        imei = generateImei(userAgent);
        persistImeiToConfig(imei);
        config.imei = imei;
      }
      return await loginWithQR(zalo, userAgent, cookiePath, qrPath, imei);
    } catch (err) {
      logWarn(`[QR] Lần ${attempt} thất bại: ${err?.message || err}`);
      if (attempt === MAX_QR_RETRY) throw err;
      logInfo("[QR] Thử lại sau 3 giây...");
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ── Kết nối thêm tài khoản từ cookie path ─────────────────────────────────────

async function createZaloClientFromCookiePath(cookiePath) {
  const config    = global.config;
  const userAgent = (config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").trim();
  const imei      = generateImei(userAgent);

  const zalo = new Zalo({
    selfListen:   true,
    checkUpdate:  false,
    logging:      false,
    imageMetadataGetter: async (filePath) => {
      const buf  = await fs.promises.readFile(filePath);
      const dim  = imageSize(buf);
      const stat = await fs.promises.stat(filePath);
      return { width: dim?.width, height: dim?.height, size: stat?.size ?? buf.length };
    },
  });

  const api = await loginWithCookie(zalo, userAgent, cookiePath, imei);
  return api;
}

module.exports = {
  createZaloClient,
  createZaloClientFromCookiePath,
  saveCookieFile,
  looksLikeZaloImei,
  generateImei,
  persistImeiToConfig,
  normalizeCookies,
};
