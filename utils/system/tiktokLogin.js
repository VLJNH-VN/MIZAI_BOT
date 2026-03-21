"use strict";

/**
 * utils/system/tiktokLogin.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tự động đăng nhập TikTok bằng tài khoản/mật khẩu và lấy cookie.
 *
 * Config cần có:
 *   "tiktokUsername": "email hoặc số điện thoại"
 *   "tiktokPassword": "mật khẩu"
 *   "tiktokCookie":   "" (sẽ được tự động điền sau đăng nhập)
 */

const fs     = require("fs");
const path   = require("path");
const axios  = require("axios");
const crypto = require("crypto");

const CONFIG_PATH = path.join(process.cwd(), "config.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    logWarn(`[TikTok] Không thể lưu config: ${e.message}`);
  }
}

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateDeviceId() {
  const hi = BigInt("0x" + crypto.randomBytes(4).toString("hex"));
  const lo = BigInt("0x" + crypto.randomBytes(4).toString("hex"));
  return ((hi << 32n) | lo).toString().replace("-", "").slice(0, 19);
}

function generateMsToken(len = 148) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

function parseCookies(setCookieArr) {
  const map = {};
  for (const raw of (setCookieArr || [])) {
    const part = raw.split(";")[0].trim();
    const idx = part.indexOf("=");
    if (idx > 0) map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return map;
}

function buildCookieString(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Bước 1: Lấy cookie khởi đầu từ TikTok web ────────────────────────────────

async function fetchInitialCookies() {
  try {
    const res = await axios.get("https://www.tiktok.com/", {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    return parseCookies(res.headers["set-cookie"]);
  } catch {
    return {};
  }
}

// ── Bước 2: Lấy msToken hợp lệ ───────────────────────────────────────────────

async function fetchMsToken(cookieMap) {
  try {
    const cookieStr = buildCookieString(cookieMap);
    const res = await axios.get("https://www.tiktok.com/api/tiktok/account/info/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Cookie":     cookieStr,
        "Referer":    "https://www.tiktok.com/",
      },
      timeout: 10000,
    });
    const extra = parseCookies(res.headers["set-cookie"]);
    Object.assign(cookieMap, extra);
  } catch {}
  return cookieMap;
}

// ── Bước 3: Đăng nhập qua Web API ────────────────────────────────────────────

async function tryWebLogin(username, password, cookieMap, deviceId) {
  const isEmail = username.includes("@");
  const msToken = generateMsToken();
  cookieMap["msToken"] = msToken;
  cookieMap["tt_chain_token"] = generateMsToken(24);
  const cookieStr = buildCookieString(cookieMap);

  const body = new URLSearchParams({
    mix_mode:     "1",
    username:     username,
    password:     password,
    email:        isEmail ? username : "",
    mobile:       isEmail ? "" : username,
    account:      username,
    captcha:      "",
    multi_login:  "1",
    aid:          "1988",
    account_sdk_source: "web",
    device_id:    deviceId,
    msToken:      msToken,
  });

  const res = await axios.post(
    "https://www.tiktok.com/api/ba/business/suite/user/login/",
    body.toString(),
    {
      headers: {
        "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Content-Type":   "application/x-www-form-urlencoded; charset=UTF-8",
        "Cookie":         cookieStr,
        "Referer":        "https://www.tiktok.com/login/phone-or-email/email",
        "Origin":         "https://www.tiktok.com",
        "Accept":         "application/json, text/plain, */*",
        "Accept-Language":"vi-VN,vi;q=0.9,en-US;q=0.8",
        "x-secsdk-csrf-token": "0",
        "x-ss-req-ticket":     String(Date.now()),
      },
      timeout: 20000,
    }
  );

  const extra = parseCookies(res.headers["set-cookie"]);
  Object.assign(cookieMap, extra);
  return { data: res.data, cookieMap };
}

// ── Bước 4: Đăng nhập qua Mobile/Passport API ────────────────────────────────

async function tryMobileLogin(username, password, deviceId, installId) {
  const isEmail    = username.includes("@");
  const passwdMd5  = md5(password);
  const androidVer = `${randInt(29, 33)}`;
  const appVer     = "34.1.2";
  const verCode    = "340102";

  const commonParams = {
    os_api:         androidVer,
    device_type:    "Pixel 7",
    ssmix:          "a",
    manifest_version_code: verCode,
    dpi:            "420",
    carrier_region:  "VN",
    uoo:            "0",
    region:         "VN",
    carrier_region_v2: "452",
    app_name:       "musical_ly",
    version_name:   appVer,
    timezone_offset: "25200",
    ts:             String(Math.floor(Date.now() / 1000)),
    ab_version:     appVer,
    residence:      "VN",
    app_type:       "normal",
    ac:             "wifi",
    update_version_code: verCode,
    channel:        "googleplay",
    device_id:      deviceId,
    iid:            installId,
    version_code:   verCode,
    aid:            "1233",
    build_number:   appVer,
    locale:         "vi",
    op_region:      "VN",
    sys_region:     "VN",
    timezone_name:  "Asia/Ho_Chi_Minh",
    cdid:           crypto.randomUUID(),
  };

  const qStr = new URLSearchParams(commonParams).toString();

  const body = new URLSearchParams({
    mix_mode:           "1",
    username:           Buffer.from(username).toString("base64"),
    email:              isEmail ? Buffer.from(username).toString("base64") : "",
    mobile:             isEmail ? "" : Buffer.from(username).toString("base64"),
    account:            Buffer.from(username).toString("base64"),
    password:           passwdMd5,
    captcha:            "",
    account_sdk_source: "app",
    multi_login:        "1",
  });

  const url = `https://api16-normal-c-useast1a.tiktokv.com/passport/user/login/?${qStr}`;

  const ua = `com.zhiliaoapp.musically/${verCode} (Linux; U; Android ${androidVer}; vi_VN; Pixel 7; Build/TP1A.220624.014; Cronet/TTNetVersion:b4d74d2f 2022-07-28 QuicV1)`;

  const res = await axios.post(url, body.toString(), {
    headers: {
      "User-Agent":   ua,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "sdk-version":  "2",
      "X-Khronos":    String(Math.floor(Date.now() / 1000)),
      "Accept":       "application/json",
    },
    timeout: 20000,
  });

  return res.data;
}

// ── Hàm chính: loginTikTok ────────────────────────────────────────────────────

async function loginTikTok(username, password) {
  const deviceId  = generateDeviceId();
  const installId = generateDeviceId();

  logInfo("[TikTok] Đang khởi tạo phiên...");
  let cookieMap = await fetchInitialCookies();
  cookieMap = await fetchMsToken(cookieMap);
  cookieMap["tt_webid_v2"] = deviceId;

  // ── Thử Mobile API trước ──────────────────────────────────────────────────
  logInfo("[TikTok] Thử đăng nhập qua Mobile API...");
  try {
    const mData = await tryMobileLogin(username, password, deviceId, installId);
    if (mData?.data?.session_key || mData?.data?.sessionid) {
      const sid = mData.data.sessionid || mData.data.session_key;
      cookieMap["sessionid"] = sid;
      cookieMap["sessionid_ss"] = sid;
      if (mData.data.user_id) cookieMap["tt_webid_v2"] = String(mData.data.user_id);
      const cookie = buildCookieString(cookieMap);
      logInfo("[TikTok] ✅ Đăng nhập Mobile API thành công!");
      return cookie;
    }
    if (mData?.message?.includes("captcha") || mData?.data?.captcha) {
      logWarn("[TikTok] Mobile API yêu cầu captcha, thử Web API...");
    } else {
      const msg = mData?.message || mData?.data?.description || JSON.stringify(mData).slice(0, 150);
      logWarn(`[TikTok] Mobile API: ${msg} — thử Web API...`);
    }
  } catch (e) {
    logWarn(`[TikTok] Mobile API lỗi: ${e.message} — thử Web API...`);
  }

  // ── Thử Web API ───────────────────────────────────────────────────────────
  logInfo("[TikTok] Thử đăng nhập qua Web API...");
  try {
    const { data: wData, cookieMap: wMap } = await tryWebLogin(username, password, cookieMap, deviceId);
    Object.assign(cookieMap, wMap);

    if (wData?.data?.sessionid || cookieMap["sessionid"]) {
      const sid = wData?.data?.sessionid || cookieMap["sessionid"];
      cookieMap["sessionid"] = sid;
      cookieMap["sessionid_ss"] = sid;
      const cookie = buildCookieString(cookieMap);
      logInfo("[TikTok] ✅ Đăng nhập Web API thành công!");
      return cookie;
    }

    if (wData?.captcha || wData?.data?.captcha) {
      throw new Error("TikTok yêu cầu xác minh captcha. Hãy đăng nhập trình duyệt 1 lần rồi thử lại, hoặc lấy cookie thủ công.");
    }

    const msg = wData?.message || wData?.data?.description || wData?.data?.describe_zh_hans || JSON.stringify(wData).slice(0, 200);
    throw new Error(`Đăng nhập thất bại: ${msg}`);
  } catch (e) {
    throw new Error(e.message);
  }
}

// ── Tự động đăng nhập khi khởi động ──────────────────────────────────────────

async function autoLoginAndSave() {
  const config   = global.config;
  const username = config.tiktokUsername;
  const password = config.tiktokPassword;

  if (!username || !password) return;

  if (config.tiktokCookie) {
    logInfo("[TikTok] Cookie đã có trong config, bỏ qua tự động đăng nhập.");
    return;
  }

  logInfo(`[TikTok] Đang tự động đăng nhập tài khoản: ${username}`);
  try {
    const cookie = await loginTikTok(username, password);
    config.tiktokCookie = cookie;
    saveConfig(config);
    logInfo("[TikTok] Cookie đã được lưu vào config.json.");
  } catch (err) {
    logWarn(`[TikTok] ${err.message}`);
  }
}

// ── Lệnh bot để lấy lại cookie thủ công ──────────────────────────────────────

async function refreshCookie() {
  const config   = global.config;
  const username = config.tiktokUsername;
  const password = config.tiktokPassword;

  if (!username || !password) {
    throw new Error("Chưa điền tiktokUsername / tiktokPassword trong config.json");
  }

  const cookie = await loginTikTok(username, password);
  config.tiktokCookie = cookie;
  saveConfig(config);
  return cookie;
}

module.exports = { autoLoginAndSave, loginTikTok, refreshCookie };
