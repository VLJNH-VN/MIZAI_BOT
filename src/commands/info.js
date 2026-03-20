"use strict";

/**
 * src/commands/info.js
 * Lấy thông tin người dùng Facebook từ Graph API
 * Credits: Deku mod by Niio-team — converted MiZai
 *
 * ⚠️ Yêu cầu: global.config.ACCESSTOKEN (Facebook Graph API token)
 */

const { parseMentionIds } = require('../../utils/bot/messageUtils');
const { fmtTimestamp: fmtTime } = require('../../utils/helpers');

function isValidURL(s) { try { new URL(s); return true; } catch { return false; } }

async function getBio(uid, api) {
  if (!uid) return "Không có";
  try {
    const form = {
      av: api.getCurrentUserID?.() || "",
      fb_api_req_friendly_name: "ProfileCometBioTextEditorPrivacyIconQuery",
      fb_api_caller_class:       "RelayModern",
      doc_id:                    "5009284572488938",
      variables:                 JSON.stringify({ id: uid }),
    };
    const src  = await api.httpPost?.("https://www.facebook.com/api/graphql/", form);
    const bio  = JSON.parse(src).data?.user?.profile_intro_card;
    return bio?.bio?.text || "Không có";
  } catch { return "Không có"; }
}

module.exports = {
  config: {
    name:            "info",
    version:         "3.1.0",
    hasPermssion:    0,
    credits:         "Deku mod by Niio-team — converted MiZai",
    description:     "Lấy thông tin người dùng Facebook qua Graph API",
    commandCategory: "Tra Cứu",
    usages:          "info [@tag | uid | link]",
    cooldowns:       5,
  },

  run: async ({ api, event, args, send, senderId, threadID, registerReaction }) => {
    const raw      = event?.data || {};
    const token    = global.config?.ACCESSTOKEN;
    if (!token) return send("⛔ Chưa cấu hình ACCESSTOKEN trong config.json.");

    // ── Xác định UID ─────────────────────────────────────────────────────────
    let uid;
    const mentionIds = parseMentionIds(event);
    if (mentionIds.length > 0) {
      uid = mentionIds[0];
    } else if (raw.quote?.ownerId || raw.msgReply?.ownerId) {
      uid = String(raw.quote?.ownerId || raw.msgReply?.ownerId);
    } else if (args[0]) {
      if (isValidURL(args[0])) {
        uid = await global.utils?.getUID?.(args[0]) || null;
      } else if (!isNaN(args[0])) {
        uid = args[0];
      }
    } else {
      uid = senderId;
    }

    if (!uid) return send("❌ Đầu vào không hợp lệ. Dùng: info [@tag | uid | link]");

    await send("🔄 Đang lấy thông tin...");

    try {
      const fields = "id,is_verified,cover,updated_time,work,education,likes,created_time,posts,hometown,username,family,timezone,link,name,locale,location,about,website,birthday,gender,relationship_status,significant_other,quotes,first_name,subscribers.limit(0)";
      const { data: r } = await global.axios.get(
        `https://graph.facebook.com/${uid}?fields=${fields}&access_token=${token}`,
        { timeout: 20000 }
      );

      const bio      = await getBio(uid, api);
      const follower = r.subscribers?.summary?.total_count || "❎";
      const hometown = r.hometown?.name || "❎";
      const cover    = r.cover?.source  || "No Cover";

      // Work
      const wk = !r.work ? "Không có" : r.work.map((w, i) =>
        `\n│ ${i+1}. ${w.employer?.name}\n│ Link: https://www.facebook.com/${w.id}\n│`
      ).join("");

      // Education
      const edc = !r.education ? "Không có" : r.education.map(e =>
        `\n│ ${e.school?.name} (${e.type})`
      ).join("");

      // Likes (max 5)
      const lkos = !r.likes?.data?.length ? "Không có" : r.likes.data.slice(0, 5).map((l, i) =>
        `\n│\n│ ${i+1}. ${l.name}\n│ (${l.category})\n│ Link: https://www.facebook.com/${l.id}`
      ).join("");

      const msg =
        `╭─────────────⭓\n` +
        `│ Tên: ${r.name}\n` +
        `│ Họ: ${r.first_name}\n` +
        `│ Username: ${r.username || "Không có"}\n` +
        `│ Date created: ${r.created_time ? fmtTime(r.created_time) : "❎"}\n` +
        `│ Wall link: ${r.link || "❎"}\n` +
        `│ Giới tính: ${r.gender === "male" ? "Nam" : r.gender === "female" ? "Nữ" : "❎"}\n` +
        `│ Mối quan hệ: ${r.relationship_status || ""} ${r.significant_other?.name || ""}\n` +
        `│ Tiểu sử: ${bio}\n` +
        `│ Nơi sinh: ${hometown}\n` +
        `│ Trường: ${edc}\n` +
        `│ Làm việc tại: ${wk}\n` +
        `│ Web: ${r.website || "Không có"}\n` +
        `│ Số follow: ${String(follower).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}\n` +
        `├─────────────⭔\n` +
        `│ Các trang đã like: ${lkos}\n` +
        `├─────────────⭔\n` +
        `│ Quốc gia: ${r.locale || "❎"}\n` +
        `│ Cập nhật: ${r.updated_time ? fmtTime(r.updated_time) : "❎"}\n` +
        `│ Múi giờ: ${r.timezone ?? "❎"}\n` +
        `╰─────────────⭓\n` +
        `👍 Thả cảm xúc để xem bài đăng`;

      // Tải avatar + cover
      const avatarUrl = `https://graph.facebook.com/${uid}/picture?width=1500&height=1500&access_token=1174099472704185|0722a7d5b5a4ac06b11450f7114eb2e9`;
      const os  = require("os");
      const fsp = require("fs").promises;

      const tmpFiles = [];
      for (const u of [avatarUrl, cover]) {
        if (!u || u === "No Cover") continue;
        try {
          const res = await global.axios.get(u, { responseType: "arraybuffer", timeout: 15000 });
          const tmp = require("path").join(os.tmpdir(), `info_${Date.now()}_${tmpFiles.length}.jpg`);
          await fsp.writeFile(tmp, Buffer.from(res.data));
          tmpFiles.push(tmp);
        } catch { /* bỏ qua ảnh lỗi */ }
      }

      const sent  = await api.sendMessage(
        { msg, attachments: tmpFiles.length ? tmpFiles : undefined },
        threadID,
        event.type
      );

      for (const f of tmpFiles) { try { require("fs").unlinkSync(f); } catch {} }
      const msgId = sent?.message?.msgId ?? sent?.msgId;
      if (msgId) {
        registerReaction({
          messageId:   String(msgId),
          commandName: "info",
          payload:     { type: "posts", uid },
          ttl:         10 * 60 * 1000,
        });
      }
    } catch (err) {
      return send(`❌ Lỗi: ${err.message}`);
    }
  },

  // ── onReaction: hiện bài đăng ─────────────────────────────────────────────
  onReaction: async ({ data, send }) => {
    if (data?.type !== "posts") return;
    const token = global.config?.ACCESSTOKEN;
    if (!token) return send("⛔ Chưa cấu hình ACCESSTOKEN.");

    try {
      const { data: r } = await global.axios.get(
        `https://graph.facebook.com/${data.uid}?fields=posts&access_token=${token}`,
        { timeout: 20000 }
      );
      const posts = r.posts?.data;
      if (!posts?.length) return send("❎ Không có bài đăng nào!");

      const msg = posts.map((p, i) =>
        `╭─────────────⭓\n` +
        `│⏰ Tạo lúc: ${p.created_time ? fmtTime(p.created_time) : "?"}\n` +
        `│✏️ Trạng thái: ${p.privacy?.description || "?"}\n` +
        `│🔀 Lượt chia sẻ: ${p.shares?.count || 0}\n` +
        `│🔗 Link: ${p.actions?.[0]?.link || "?"}\n` +
        `│📝 Nội dung: ${p.message || "(không có)"}\n` +
        `╰─────────────⭓`
      ).join("\n");

      return send(msg);
    } catch (err) {
      return send(`❌ Lỗi: ${err.message}`);
    }
  },
};
