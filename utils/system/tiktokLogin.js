"use strict";

const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");

const CONFIG_PATH = path.join(process.cwd(), "config.json");

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function generateDeviceId() {
  return BigInt("0x" + crypto.randomBytes(8).toString("hex")).toString().slice(0, 19);
}

function generateInstallId() {
  return BigInt("0x" + crypto.randomBytes(8).toString("hex")).toString().slice(0, 19);
}

function generateMsToken(length = 148) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let token = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

async function getInitialCookies(ua) {
  try {
    const res = await axios.get("https://www.tiktok.com/", {
      headers: {
        "User-Agent": ua,
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    const setCookies = res.headers["set-cookie"] || [];
    const cookieMap = {};
    for (const c of setCookies) {
      const [kv] = c.split(";");
      const idx = kv.indexOf("=");
      if (idx > 0) {
        const key = kv.slice(0, idx).trim();
        const val = kv.slice(idx + 1).trim();
        cookieMap[key] = val;
      }
    }
    return cookieMap;
  } catch {
    return {};
  }
}

function buildCookieString(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function loginTikTok(username, password) {
  const ua = "com.zhiliaoapp.musically/2022600030 (Linux; U; Android 12; en_US; Pixel 6; Build/SQ3A.220705.003.A1; Cronet/TTNetVersion:b4d74d2f 2022-07-28 QuicV1)";

  logInfo("[TikTok] Đang lấy cookie khởi tạo...");
  const initCookies = await getInitialCookies("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  const msToken    = generateMsToken();
  const deviceId   = generateDeviceId();
  const installId  = generateInstallId();

  initCookies["msToken"]       = msToken;
  initCookies["tt_chain_token"] = generateMsToken(24);

  const cookieStr = buildCookieString(initCookies);

  const params = new URLSearchParams({
    "mix_mode":      "1",
    "username":      username,
    "password":      password,
    "email":         username.includes("@") ? username : "",
    "mobile":        username.includes("@") ? "" : username,
    "account":       username,
    "multi_login":   "1",
    "aid":           "1988",
    "app_name":      "tiktok_web",
    "device_type":   "web_h5",
    "device_id":     deviceId,
    "install_id":    installId,
    "channel":       "tiktok_web",
    "version_code":  "270000",
    "version_name":  "27.0.0",
  });

  logInfo("[TikTok] Đang đăng nhập...");

  let res;
  try {
    res = await axios.post(
      "https://www.tiktok.com/api/v1/web/account/login/",
      params.toString(),
      {
        headers: {
          "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Content-Type":   "application/x-www-form-urlencoded",
          "Cookie":         cookieStr,
          "Referer":        "https://www.tiktok.com/login/",
          "Origin":         "https://www.tiktok.com",
          "Accept":         "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9",
        },
        timeout: 20000,
      }
    );
  } catch (e) {
    throw new Error(`Lỗi kết nối TikTok: ${e.message}`);
  }

  const setCookies = res.headers["set-cookie"] || [];
  for (const c of setCookies) {
    const [kv] = c.split(";");
    const idx = kv.indexOf("=");
    if (idx > 0) {
      initCookies[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
    }
  }

  const data = res.data || {};
  if (data.data?.sessionid || initCookies["sessionid"]) {
    const sessionid = data.data?.sessionid || initCookies["sessionid"];
    initCookies["sessionid"] = sessionid;
    const finalCookie = buildCookieString(initCookies);
    logInfo("[TikTok] ✅ Đăng nhập thành công! Đang lưu cookie...");
    return finalCookie;
  }

  if (data.captcha || data.data?.captcha) {
    throw new Error("TikTok yêu cầu captcha — không thể tự động đăng nhập. Hãy lấy cookie thủ công từ trình duyệt.");
  }

  const message = data.message || data.data?.describe_zh_hans || JSON.stringify(data).slice(0, 200);
  throw new Error(`Đăng nhập thất bại: ${message}`);
}

async function autoLoginAndSave() {
  const config = global.config;
  const username = config.tiktokUsername;
  const password = config.tiktokPassword;

  if (!username || !password) return;
  if (config.tiktokCookie) {
    logInfo("[TikTok] Cookie đã có trong config, bỏ qua tự động đăng nhập.");
    return;
  }

  try {
    const cookie = await loginTikTok(username, password);
    config.tiktokCookie = cookie;
    saveConfig(config);
    logInfo("[TikTok] Cookie đã được lưu vào config.json.");
  } catch (err) {
    logWarn(`[TikTok] ${err.message}`);
  }
}

module.exports = { autoLoginAndSave, loginTikTok };
