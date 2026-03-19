/**
 * utils/system/global.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Đăng ký các tiện ích dùng chung lên global.
 * Require file này 1 lần trong index.js — sau đó tất cả lệnh dùng trực tiếp.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  GLOBAL SẴN CÓ SAU KHI BOT KHỞI ĐỘNG                                  │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.config       │ Nội dung config.json                            │
 * │  global.api          │ Zalo API instance (set sau khi login)           │
 * │  global.botId        │ Zalo ID của bot (string)                        │
 * │  global.commands     │ Map<name, command> tất cả lệnh đang nạp         │
 * │  global.prefix       │ Prefix hiện tại (vd: ".")                       │
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
 * │  global.uploadImage  │ Upload ảnh/file lên GitHub → rawUrl             │
 * │    global.uploadImage(input, name?) → Promise<string> rawUrl GitHub    │
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
 * │  global.startAutoGetData()  Khởi động vòng lặp auto giải mã GitHub     │
 * │    Mỗi phút: decode tối đa 10 file → xóa sau 1 phút → lặp lại         │
 * │  global.stopAutoGetData()   Dừng vòng lặp                              │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.githubMedia  │ Upload/decode media qua GitHub (base64)         │
 * │    .upload(filePath, options?)                                          │
 * │      options: { folder?, key?, overwrite? }                            │
 * │      → Promise<{ key, rawUrl, apiUrl }>                                │
 * │    .decode(keyOrApiUrl, outputPath?)                                   │
 * │      → Promise<Buffer>  (lưu file nếu có outputPath)                  │
 * │    .links()  → object  (toàn bộ githubMediaLinks.json)                │
 * │  Config (config.json):                                                  │
 * │    githubToken  — Personal Access Token (scope: repo)                  │
 * │    uploadRepo   — "owner/repo" vd: "VLJNH-VN/UPLOAD_MIZAI"            │
 * │    branch       — Nhánh (mặc định "main")                              │
 * ├──────────────────────┬──────────────────────────────────────────────────┤
 * │  global.mediaCache   │ Filecache: giải mã GitHub base64 → disk         │
 * │    .processAll(opts?)          → Promise decode entry mới → cache      │
 * │    .decodeOne(key, opts?)      → Promise<string|null> cachedPath        │
 * │    .loadIndex()                → array (dataCache.json)                │
 * │    .pickRandom({videoOnly?,ext?}) → object|null                        │
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
const { getDb }                               = require("../../includes/database/sqlite");
const economy                                 = require("../../includes/database/economy");
const { resolveSenderName, resolveGroupName } = require("../../includes/database/infoCache");
const { getBotAdminIds, isBotAdmin, isGroupAdmin } = require("../bot/botManager");
const { logInfo, logWarn, logError, logEvent, logDebug } = require("./logger");
const { checkGroqKey, setAutoCheck }          = require("./maintenance");
const { processGaiData, resolveQuote }        = require("../bot/messageUtils");
const {
  encodeAndUploadToGithub,
  uploadToGithub,
  decodeFromGithub,
  getMediaLinks,
}                                             = require("../media/githubMedia");
const {
  processAll   : mediaCacheProcessAll,
  decodeOne    : mediaCacheDecodeOne,
  loadIndex    : mediaCacheLoadIndex,
  pickRandom   : mediaCachePickRandom,
}                                             = require("../media/media");
const { startAutoGetData, stopAutoGetData }   = require("./maintenance");
const msgCache                                = require("../../includes/database/messageCache");

// ── Logger ────────────────────────────────────────────────────────────────────
global.logInfo   = logInfo;
global.logWarn   = logWarn;
global.logError  = logError;
global.logEvent  = logEvent;
global.logDebug  = logDebug;

// ── Tiện ích ──────────────────────────────────────────────────────────────────
global.axios             = axios;
global.getDb             = getDb;
global.economy           = economy;
global.resolveSenderName = resolveSenderName;
global.resolveGroupName  = resolveGroupName;
global.getBotAdminIds    = getBotAdminIds;
global.isBotAdmin        = isBotAdmin;
global.isGroupAdmin      = isGroupAdmin;

/**
 * Upload ảnh / file lên GitHub rồi trả về rawUrl công khai.
 * Chấp nhận: URL, đường dẫn file local, hoặc Buffer.
 * @param {string|Buffer} input
 * @param {string} [name] - Tên file (dùng khi input là Buffer)
 * @returns {Promise<string>} rawUrl công khai (raw.githubusercontent.com)
 */
global.uploadImage = async function uploadImage(input, name = "image.jpg") {
  return uploadToGithub(input, name, { folder: "media/images" });
};

// ── Key manager ───────────────────────────────────────────────────────────────
global.checkGroqKey  = checkGroqKey;
global.setAutoCheck  = setAutoCheck;

// ── Xử lý video gai ──────────────────────────────────────────────────────────
global.processGaiData = processGaiData;

// ── GitHub Media (base64 encode → upload → decode) ────────────────────────────
/**
 * global.githubMedia.upload(filePath, options?)
 *   Mã hóa file media bằng base64 và tải lên GitHub.
 *   options: { folder?, key?, overwrite? }
 *   → Promise<{ key, rawUrl, apiUrl }>
 *
 * global.githubMedia.decode(keyOrApiUrl, outputPath?)
 *   Tải file từ GitHub và giải mã base64 về Buffer (hoặc lưu vào file).
 *   → Promise<Buffer>
 *
 * global.githubMedia.links()
 *   Trả về toàn bộ nội dung githubMediaLinks.json.
 *   → object
 *
 * Env cần thiết:
 *   GITHUB_TOKEN  - Personal Access Token (scope: repo)
 *   GITHUB_OWNER  - Tên tài khoản GitHub
 *   GITHUB_REPO   - Tên repository
 *   GITHUB_BRANCH - Nhánh (mặc định "main")
 */
global.githubMedia = {
  upload: encodeAndUploadToGithub,
  decode: decodeFromGithub,
  links:  getMediaLinks,
};

/**
 * global.mediaCache — Quản lý filecache video đã giải mã từ GitHub
 *   .processAll(opts?)   → Promise<{success,fail,total,saved}>  decode entry mới
 *   .decodeOne(key,opts?) → Promise<string|null>  decode 1 entry theo key
 *   .loadIndex()         → array  toàn bộ dataCache.json
 *   .pickRandom(opts?)   → object|null  chọn ngẫu nhiên 1 entry có file trên disk
 *     opts: { videoOnly?, ext? }
 */
global.mediaCache = {
  processAll : mediaCacheProcessAll,
  decodeOne  : mediaCacheDecodeOne,
  loadIndex  : mediaCacheLoadIndex,
  pickRandom : mediaCachePickRandom,
};

// ── Auto GetData ──────────────────────────────────────────────────────────────
global.startAutoGetData = startAutoGetData;
global.stopAutoGetData  = stopAutoGetData;

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

module.exports = { setApi };
