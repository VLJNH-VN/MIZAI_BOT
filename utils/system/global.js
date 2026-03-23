/**
 * utils/system/global.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Đăng ký các tiện ích dùng chung lên global.
 * Require file này 1 lần trong index.js — sau đó tất cả lệnh dùng trực tiếp.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  GLOBAL SẴN CÓ SAU KHI BOT KHỞI ĐỘNG                                  │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.config       │ Nội dung config.json          (set tại index.js)│
 * │  global.userAgent    │ User-Agent dùng chung (lấy từ config.json)      │
 * │  global.api          │ Zalo API instance (set sau khi login)           │
 * │  global.botId        │ Zalo ID của bot (string)      (set tại index.js)│
 * │  global.commands     │ Map<name, command> tất cả lệnh(set tại index.js)│
 * │  global.prefix       │ Prefix mặc định toàn cục      (set tại index.js)│
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.restartBot(reason?, delayMs?)                                  │
 * │                      │ Restart bot an toàn  (set tại loader.js)        │
 * │  global.txTime       │ Bộ đếm giây phiên Tài Xỉu   (set tại txLoop.js)│
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.Users        │ Controller người dùng (AURABOT-style)           │
 * │    .getData(uid, name?, gender?)  → { uid,name,gender,money,exp,... }  │
 * │    .getInfo(uid)      → object|null                                    │
 * │    .setGender(uid, gender)  / .getGender(uid) → string                 │
 * │    .addMoney(uid, n)  → number  | .decreaseMoney(uid, n) → boolean     │
 * │    .addExp(uid, n)    → number  | .getTopMoney/Exp(limit) → array      │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.Threads      │ Controller nhóm (AURABOT-style)                 │
 * │    .getPrefix(id)    → string   prefix riêng nhóm (cache 5 phút)      │
 * │    .setPrefix(id, p)            lưu prefix và xoá cache                │
 * │    .getRankup(id)    → boolean  | .setRankup(id, v)                    │
 * │    .getSettings(id)  → object   | .setSettings(id, obj)                │
 * │    .getSetting(id, key, def?) → any | .setSetting(id, key, val)        │
 * │    .getData(id, name?) → row đầy đủ từ DB                              │
 * │    .clearPrefixCache(id?) → void                                       │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.axios        │ HTTP client (axios)                             │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.getDb()      │ → Promise<db>  SQLite instance                  │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.economy      │ Hệ thống tiền tệ (xem mục Economy bên dưới)    │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.resolveSenderName({ api, userId, fallbackName? })              │
 * │                      │ → Promise<string>  Tên người dùng (có cache)    │
 * │  global.resolveGroupName({ api, groupId, fallbackName? })              │
 * │                      │ → Promise<string>  Tên nhóm (có cache)          │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.getBotAdminIds()         → Set<string>                         │
 * │  global.isBotAdmin(userId)       → boolean                             │
 * │  global.isGroupAdmin({ api, groupId, userId }) → Promise<boolean>      │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.zaloSendVoice(api, source, threadId, type, ttl?)               │
 * │    source: URL hoặc đường dẫn file local AAC/MP3                       │
 * │    → gửi voice (download → AAC → upload CDN → sendVoice)              │
 * │  global.zaloSendVideo(api, opts, threadId, type)                       │
 * │    opts: { videoUrl, videoPath?, msg?, width?, height?, duration? }    │
 * │  global.zaloUploadThumbnail(api, videoPath, threadId, type) → url|null │
 * │  global.zaloUploadAttachment(api, filePath, threadId, type) → url|null │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.sendMessage(message, threadId, threadType) → Promise           │
 * │    message: string | object { msg, attachments, ... }                  │
 * │    threadType: ThreadType.Group | ThreadType.User                      │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.upload(filePaths, threadId, threadType)                        │
 * │    filePaths: string | string[]  (đường dẫn file local)                │
 * │    → Promise<Array<{ fileUrl, ... }>>  Kết quả từ uploadAttachment     │
 * │    Dùng khi cần lấy fileUrl để gửi video/audio qua api.sendVideo       │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.restartBot(reason?, delayMs?)  → void  Restart bot             │
 * │  global.checkGroqKey(key) → Promise<{ key, status: "live"|"dead" }>   │
 * │  global.setAutoCheck(boolean)  → void  Bật/tắt tự động check key      │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.githubUpload(localFilePath, repoFilePath, options?)            │
 * │    → Promise<string>  download_url trên GitHub                         │
 * │    options: { repo, branch, message }                                  │
 * │    Mặc định dùng config.uploadRepo, config.branch                      │
 * │  global.githubDownload(repoFilePath, localFilePath, options?)          │
 * │    → Promise<string>  localFilePath đã lưu                             │
 * │    options: { repo, branch }                                           │
 * │    Mặc định dùng config.repo, config.branch                            │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.registerCustomSticker(api)                                     │
 * │    Đăng ký api.sendCustomSticker lên Zalo API instance.                │
 * │    Gọi 1 lần trước khi dùng api.sendCustomSticker(...)                 │
 * │    api.sendCustomSticker({ staticImgUrl, animationImgUrl,              │
 * │                            threadId, threadType })                     │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.logInfo(msg)   │ [INFO]  xanh lá                               │
 * │  global.logWarn(msg)   │ [WARN]  vàng                                  │
 * │  global.logError(msg)  │ [ERROR] đỏ                                    │
 * │  global.logEvent(msg)  │ [EVENT] tím                                   │
 * │  global.logDebug(msg)  │ chỉ hiện khi DEBUG=1                          │
 * └──────────────────────┴──────────────────────────────────────────────────┘
 *
 * ECONOMY — global.economy:
 *   .getUserMoney(userId, name?)               → Promise<number>
 *   .getUserData(userId)                        → Promise<object>
 *     object: { user_id, name, money, exp, daily_last, updated_at }
 *   .updateUserMoney(userId, amount, type, name?)
 *     type: "add" | "sub" | "set"              → Promise<number|false>
 *     Trả về false nếu số dư âm sau khi trừ
 *   .hasEnoughMoney(userId, amount)             → Promise<boolean>
 *   .transferMoney(fromId, toId, amount, fromName?, toName?)
 *     → Promise<{ success, fromNew, toNew } | { success: false, reason }>
 *   .claimDaily(userId, name?)
 *     → Promise<{ success: true, reward, newMoney, newExp }
 *              | { success: false, remaining }>
 *   .addExp(userId, amount)                     → Promise<void>
 *   .getTopUsers(limit?)                        → Promise<array>
 *   .formatMoney(amount)                        → string  "1.000 VNĐ"
 *   .formatTime(ms)                             → string  "1h 30m 20s"
 *   .getLevel(exp)                              → number
 */

const axios   = require("axios");
const { getDb }                               = require("../../includes/database/core/sqlite");
const economy                                 = require("../../includes/database/user/economy");
const { resolveSenderName, resolveGroupName } = require("../../includes/database/message/infoCache");
const { getBotAdminIds, isBotAdmin, isGroupAdmin } = require("../bot/botManager");
const { logInfo, logWarn, logError, logEvent, logDebug } = require("./logger");
const { checkGroqKey, setAutoCheck }          = require("./maintenance");
const { processGaiData, resolveQuote }        = require("../bot/messageUtils");
const { registerCustomSticker }               = require("../bot/sendCustomSticker");
const cawr                                    = require("../bot/cawr");
const msgCache                                = require("../../includes/database/message/messageCache");
const groupLoader                             = require("../../includes/database/group/groupLoader");
const dataManager                             = require("../../includes/database/core/dataManager");
const userController                          = require("../../includes/database/user/userController");
const groupSettings                           = require("../../includes/database/group/groupSettings");
const {
  zaloSendVoice,
  zaloSendVideo,
  uploadThumbnail       : _zaloUploadThumbnail,
  uploadAttachmentToZalo: _zaloUploadAttachment,
}                                             = require("../media/zaloMedia");

// ── Logger ────────────────────────────────────────────────────────────────────
global.logInfo   = logInfo;
global.logWarn   = logWarn;
global.logError  = logError;
global.logEvent  = logEvent;
global.logDebug  = logDebug;

// ── User-Agent dùng chung (lấy từ config.json) ───────────────────────────────
global.userAgent = (global.config?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").trim();

// ── Tiện ích ──────────────────────────────────────────────────────────────────
global.axios             = axios;
global.getDb             = getDb;
global.economy           = economy;
global.resolveSenderName = resolveSenderName;
global.resolveGroupName  = resolveGroupName;
global.getBotAdminIds    = getBotAdminIds;
global.isBotAdmin        = isBotAdmin;
global.isGroupAdmin      = isGroupAdmin;

// ── Key manager ───────────────────────────────────────────────────────────────
global.checkGroqKey  = checkGroqKey;
global.setAutoCheck  = setAutoCheck;

// ── Group loader ──────────────────────────────────────────────────────────────
// global.groupLoader.loadAllGroups(api)      — fetch tất cả nhóm từ API → DB
// global.groupLoader.syncGroupToDb(api, id)  — fetch + lưu 1 nhóm
// global.groupLoader.getAllGroupsFromDb()     — đọc toàn bộ nhóm từ SQLite
// global.groupLoader.getGroupData(groupId)   — đọc 1 nhóm từ SQLite
// global.groupLoader.getGroupIds()           — danh sách group_id từ cache
// global.groupLoader.saveGroupsSnapshot()    — xuất JSON ra includes/data/groups.json
global.groupLoader = groupLoader;

// ── Data Manager (user + group CRUD) ─────────────────────────────────────────
// global.db.saveUser(userId, { name, profile }, { increment })
// global.db.getUser(userId)
// global.db.getAllUsers({ limit, orderBy })
// global.db.searchUsers(keyword)
// global.db.getUserStats()
// global.db.saveGroup(groupId, { name, info, memVerList, pendingApprove })
// global.db.getGroup(groupId)
// global.db.getAllGroups({ limit, orderBy })
// global.db.searchGroups(keyword)
// global.db.getGroupStats()
// global.db.autoSaveFromEvent(api, event)
// global.db.saveSnapshot()
// global.db.getStats()
global.db = dataManager;

// ── Users controller (AURABOT-style) ─────────────────────────────────────────
// global.Users.getData(uid, name?, gender?)   → { uid, name, gender, money, exp, ... }
// global.Users.getInfo(uid)                   → object|null
// global.Users.setGender(uid, gender)         → void
// global.Users.getGender(uid)                 → string  ("Male"/"Female"/"Unknown")
// global.Users.addMoney(uid, amount)          → number  (số dư mới)
// global.Users.decreaseMoney(uid, amount)     → boolean (false nếu không đủ)
// global.Users.addExp(uid, amount)            → number  (exp mới)
// global.Users.getTopMoney(limit?)            → array
// global.Users.getTopExp(limit?)              → array
global.Users = userController;

// ── Threads controller (AURABOT-style) ───────────────────────────────────────
// global.Threads.getPrefix(threadId)              → string  prefix riêng nhóm
// global.Threads.setPrefix(threadId, prefix)      → void
// global.Threads.getRankup(threadId)              → boolean
// global.Threads.setRankup(threadId, value)       → void
// global.Threads.getSettings(threadId)            → object  toàn bộ settings
// global.Threads.getSetting(threadId, key, def?)  → any     một key
// global.Threads.setSetting(threadId, key, value) → void
// global.Threads.setSettings(threadId, obj)       → void
// global.Threads.getData(threadId, name?)         → object  row đầy đủ
// global.Threads.clearPrefixCache(threadId?)      → void
global.Threads = groupSettings;

// ── Xử lý video gai ──────────────────────────────────────────────────────────
global.processGaiData = processGaiData;

// ── Zalo Media Helpers — dùng chung cho voice / video ────────────────────────
// global.zaloSendVoice(api, source, threadId, threadType, ttl?)
//   source: URL hoặc đường dẫn file local (AAC/MP3/...)
// global.zaloSendVideo(api, opts, threadId, threadType)
//   opts: { videoUrl, videoPath?, msg?, width?, height?, duration?, ttl? }
// global.zaloUploadThumbnail(api, videoPath, threadId, threadType) → url|null
// global.zaloUploadAttachment(api, filePath, threadId, threadType) → url|null
global.zaloSendVoice        = zaloSendVoice;
global.zaloSendVideo        = zaloSendVideo;
global.zaloUploadThumbnail  = _zaloUploadThumbnail;
global.zaloUploadAttachment = _zaloUploadAttachment;

// ── CAWR — Thư viện tiện ích dùng chung ──────────────────────────────────────
// global.cawr.tt.search(query, limit)           → Promise<Array>
// global.cawr.tt.getVideo(tiktokUrl)            → Promise<{ videoUrl, ... }>
// global.cawr.tt.uploadVideo(url, tipName, uid) → Promise<string|null>
// global.cawr.tt.isDuplicate(list, ghUrl)       → boolean
// global.cawr.tt.loadList(name)                 → string[]
// global.cawr.tt.saveList(name, data)           → void
// global.cawr.tt.pickRandom(name)               → string|null
// global.cawr.tt.bulkAdd(name, query, limit)    → Promise<{ success, skipped, failed, ... }>
global.cawr = cawr;

// ── sendCustomSticker — Zalo sticker qua photo_url endpoint (Python zlapi) ───
global.registerCustomSticker = registerCustomSticker;

// ── Ljzi — Danh sách video gái / anime ───────────────────────────────────────
// global.Ljzi.vdgai              → string[]   danh sách URL video gái
// global.Ljzi.vdani              → string[]   danh sách URL video anime
// global.Ljzi.pick(name)         → string|null
// global.Ljzi.send(api,event,name) → Promise
require("./ljzi");

// ── Message Cache + resolveQuote ──────────────────────────────────────────────
/**
 * global.messageCache
 *   .store(event)                    — lưu tin nhắn (gọi tự động trong message.js)
 *   .getById(msgId, threadId?)       — tra theo msgId
 *   .getByCliId(cliMsgId, threadId?) — tra theo cliMsgId
 *   .getThread(threadId, limit?)     — lấy N tin gần nhất của nhóm
 *
 * global.resolveQuote({ raw, api, threadId, event })
 *   → Promise<object|null>
 *   Trả về nội dung đầy đủ của tin được reply:
 *     { msgId, cliMsgId, uidFrom, content, attach,
 *       mediaUrl, ext, isMedia, isText, _source }
 *   _source: "quote" | "cache" | "history"
 */
global.messageCache  = msgCache;
global.resolveQuote  = resolveQuote;

/**
 * Gọi trong index.js sau khi đăng nhập Zalo thành công.
 * @param {object} apiInstance
 */
function setApi(apiInstance) {
  global.api = apiInstance;

  global.sendMessage = (message, threadId, type) => {
    const payload = typeof message === "string" ? { msg: message } : message;
    return apiInstance.sendMessage(payload, threadId, type);
  };

  /**
   * Upload file local lên Zalo và trả về thông tin file.
   * Tương đương uploadVideo() trong Roomie, nhưng dùng zca-js.
   *
   * @param {string|string[]} filePaths - Đường dẫn file local (hoặc mảng nhiều file)
   * @param {string} threadId
   * @param {import("zca-js").ThreadType} threadType
   * @returns {Promise<Array<{fileUrl: string, [key: string]: any}>>}
   *
   * Ví dụ:
   *   const [res] = await global.upload("/tmp/video.mp4", threadId, event.type);
   *   await api.sendVideo({ videoUrl: res.fileUrl, ... }, threadId, event.type);
   */
  global.upload = async (filePaths, threadId, threadType) => {
    const arr = Array.isArray(filePaths) ? filePaths : [filePaths];
    const result = await apiInstance.uploadAttachment(arr, threadId, threadType);
    return result;
  };
}

// ── GitHub Upload / Download ──────────────────────────────────────────────────
/**
 * global.githubUpload(localFilePath, repoFilePath, options?)
 *   Upload file local lên GitHub (uploadRepo trong config).
 *   @param {string} localFilePath  - Đường dẫn file local cần upload
 *   @param {string} repoFilePath   - Đường dẫn đích trong repo (vd: "media/video.mp4")
 *   @param {object} [options]      - { repo, branch, message }
 *   @returns {Promise<string>}     - download_url của file trên GitHub
 *
 * global.githubDownload(repoFilePath, localFilePath, options?)
 *   Download file từ GitHub (repo trong config) về local.
 *   @param {string} repoFilePath   - Đường dẫn file trong repo (vd: "data/config.json")
 *   @param {string} localFilePath  - Đường dẫn local để lưu file
 *   @param {object} [options]      - { repo, branch }
 *   @returns {Promise<string>}     - localFilePath đã lưu
 */
(function registerGithubHelpers() {
  const fs   = require("fs");
  const path = require("path");

  global.githubUpload = async (localFilePath, repoFilePath, options = {}) => {
    const token  = global.config?.githubToken || process.env.GITHUB_TOKEN;
    const repo   = options.repo   || global.config?.uploadRepo || global.config?.repo;
    const branch = options.branch || global.config?.branch || "main";

    if (!token) throw new Error("[githubUpload] Thiếu githubToken — đặt trong config.json hoặc biến môi trường GITHUB_TOKEN");
    if (!repo)  throw new Error("[githubUpload] Thiếu repo/uploadRepo trong config.json");

    const content = fs.readFileSync(localFilePath);
    const base64  = content.toString("base64");
    const apiUrl  = `https://api.github.com/repos/${repo}/contents/${repoFilePath}`;
    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "MIZAI_BOT"
    };

    // Lấy sha nếu file đã tồn tại (để update)
    let sha;
    try {
      const existing = await axios.get(apiUrl, { headers, params: { ref: branch } });
      sha = existing.data.sha;
    } catch (_) { /* file chưa tồn tại → tạo mới */ }

    const body = {
      message: options.message || `upload: ${path.basename(repoFilePath)}`,
      content: base64,
      branch
    };
    if (sha) body.sha = sha;

    const res = await axios.put(apiUrl, body, { headers });
    return res.data?.content?.download_url || null;
  };

  /**
   * global.githubReleaseUpload(localFilePath, filename, options?)
   *   Upload file lên GitHub Releases → trả về browser_download_url (objects.githubusercontent.com)
   *   URL này Zalo server chấp nhận trong api.sendVideo (raw.githubusercontent.com bị reject).
   */
  global.githubReleaseUpload = async (localFilePath, filename, options = {}) => {
    const token = global.config?.githubToken || process.env.GITHUB_TOKEN;
    const repo  = options.repo || global.config?.uploadRepo || global.config?.repo;
    const tag   = options.tag  || "vd-upload";

    if (!token) throw new Error("[githubReleaseUpload] Thiếu githubToken — đặt trong config.json hoặc biến môi trường GITHUB_TOKEN");
    if (!repo)  throw new Error("[githubReleaseUpload] Thiếu uploadRepo trong config.json");

    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "MIZAI_BOT"
    };

    const [owner, repoName] = repo.split("/");

    // Tìm release với tag đã tồn tại hoặc tạo mới
    let releaseId;
    try {
      const existing = await axios.get(
        `https://api.github.com/repos/${owner}/${repoName}/releases/tags/${tag}`,
        { headers }
      );
      releaseId = existing.data.id;
    } catch (_) {
      const created = await axios.post(
        `https://api.github.com/repos/${owner}/${repoName}/releases`,
        { tag_name: tag, name: tag, body: "Auto-upload by MIZAI bot", draft: false, prerelease: false },
        { headers }
      );
      releaseId = created.data.id;
    }

    // Xóa asset trùng tên + asset kẹt "new" state trước khi upload (tránh 422)
    try {
      const assets = await axios.get(
        `https://api.github.com/repos/${owner}/${repoName}/releases/${releaseId}/assets`,
        { headers }
      );
      const toDelete = assets.data.filter(a => a.name === filename || a.state === "new");
      for (const a of toDelete) {
        try {
          await axios.delete(
            `https://api.github.com/repos/${owner}/${repoName}/releases/assets/${a.id}`,
            { headers }
          );
        } catch (_) {}
      }
    } catch (_) {}

    // Upload asset — retry tối đa 3 lần (422 đổi tên, lỗi mạng giữ tên)
    const fileData = fs.readFileSync(localFilePath);
    let uploadRes, lastName = filename;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        uploadRes = await axios.post(
          `https://uploads.github.com/repos/${owner}/${repoName}/releases/${releaseId}/assets?name=${encodeURIComponent(lastName)}`,
          fileData,
          {
            headers: {
              ...headers,
              "Content-Type": "application/octet-stream",
              "Content-Length": fileData.length,
            },
            maxBodyLength:    Infinity,
            maxContentLength: Infinity,
            timeout:          180000,
          }
        );
        break;
      } catch (e) {
        const is422    = e.response?.status === 422;
        const isNetErr = !e.response && (
          e.code === "ECONNRESET" || e.code === "ECONNABORTED" ||
          e.code === "ETIMEDOUT"  || (e.message || "").includes("socket hang up")
        );
        if ((is422 || isNetErr) && attempt < 3) {
          if (is422) lastName = filename.replace(".mp4", `_r${attempt}.mp4`);
          global.logWarn?.(`[githubReleaseUpload] Lần ${attempt} lỗi (${e.message}), thử lại...`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        } else {
          throw e;
        }
      }
    }

    return uploadRes.data?.browser_download_url || null;
  };

  global.githubDownload = async (repoFilePath, localFilePath, options = {}) => {
    const token  = global.config?.githubToken || process.env.GITHUB_TOKEN;
    const repo   = options.repo   || global.config?.repo;
    const branch = options.branch || global.config?.branch || "main";

    if (!token) throw new Error("[githubDownload] Thiếu githubToken — đặt trong config.json hoặc biến môi trường GITHUB_TOKEN");
    if (!repo)  throw new Error("[githubDownload] Thiếu repo trong config.json");

    const apiUrl  = `https://api.github.com/repos/${repo}/contents/${repoFilePath}`;
    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "MIZAI_BOT"
    };

    const res = await axios.get(apiUrl, { headers, params: { ref: branch } });

    const fileContent = Buffer.from(res.data.content, "base64");
    const dir = path.dirname(localFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localFilePath, fileContent);

    return localFilePath;
  };
})();


module.exports = { setApi };
