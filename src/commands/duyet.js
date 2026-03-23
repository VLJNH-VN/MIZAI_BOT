/**
 * src/commands/duyet.js
 * Lệnh duyệt / hủy yêu cầu theo số thứ tự (stt).
 *
 * Cách dùng (chỉ Admin bot):
 *   .duyet            → Xem danh sách yêu cầu đang chờ
 *   .duyet <stt>      → Duyệt yêu cầu số <stt>
 *   .duyet <stt> <lý do>
 *   .huy <stt>        → Hủy yêu cầu số <stt>
 *   .huy <stt> <lý do>
 *
 * Hoặc admin REPLY trực tiếp vào tin nhắn thông báo của bot:
 *   Reply ".duyet"    → Duyệt yêu cầu đó
 *   Reply ".huy"      → Hủy yêu cầu đó
 *   Reply ".huy <lý do>"
 */

const {
  getRequest,
  getRequestByMsgId,
  getPendingList,
  resolveRequest
} = require('../../includes/database/core/requestQueue');
const { updateUserMoney, formatMoney } = require('../../includes/database/user/economy');
const { resolveSenderName } = require('../../includes/database/message/infoCache');
const { ThreadType } = require("zca-js");

// ── Xử lý khi yêu cầu được duyệt ─────────────────────────────────────────────
async function handleApprove({ api, item, adminId, adminName, reason, send }) {
  if (item.type === "naptien") {
    const amount = item.extra?.amount || 0;
    await updateUserMoney(item.userId, amount, "add");
    const msg =
      `✅ Yêu cầu #${item.stt} đã được DUYỆT!\n` +
      `👤 Người dùng: ${item.userName}\n` +
      `💵 Số tiền nạp: ${formatMoney(amount)}\n` +
      `👑 Admin: ${adminName}` +
      (reason ? `\n📝 Ghi chú: ${reason}` : "");
    await send(msg);
    // Gửi thông báo cho người dùng nếu khác hội thoại
    try {
      if (String(item.threadId) !== String(api.getOwnId?.() || "")) {
        await api.sendMessage(
          { msg: `✅ Yêu cầu nạp tiền #${item.stt} của bạn đã được duyệt!\n💰 +${formatMoney(amount)} đã được cộng vào tài khoản.` },
          item.threadId,
          ThreadType.User
        );
      }
    } catch {}
    return;
  }

  // Loại yêu cầu khác (generic)
  await send(
    `✅ Yêu cầu #${item.stt} đã được DUYỆT!\n` +
    `👤 Người dùng: ${item.userName}\n` +
    `📋 Nội dung: ${item.content || "(không có)"}\n` +
    `👑 Admin: ${adminName}` +
    (reason ? `\n📝 Ghi chú: ${reason}` : "")
  );
  try {
    await api.sendMessage(
      { msg: `✅ Yêu cầu #${item.stt} của bạn đã được duyệt!` + (reason ? `\n📝 ${reason}` : "") },
      item.threadId,
      ThreadType.User
    );
  } catch {}
}

// ── Xử lý khi yêu cầu bị hủy ─────────────────────────────────────────────────
async function handleReject({ api, item, adminId, adminName, reason, send }) {
  const msg =
    `❌ Yêu cầu #${item.stt} đã bị HỦY!\n` +
    `👤 Người dùng: ${item.userName}\n` +
    `📋 Loại: ${item.type}` +
    (item.content ? `\n📝 Nội dung: ${item.content}` : "") +
    `\n👑 Admin: ${adminName}` +
    (reason ? `\n🚫 Lý do: ${reason}` : "");
  await send(msg);
  try {
    await api.sendMessage(
      { msg: `❌ Yêu cầu #${item.stt} của bạn đã bị hủy!` + (reason ? `\n🚫 Lý do: ${reason}` : "") },
      item.threadId,
      ThreadType.User
    );
  } catch {}
}

// ── Hiển thị danh sách chờ duyệt ──────────────────────────────────────────────
function buildPendingList(list) {
  if (list.length === 0) return "📭 Không có yêu cầu nào đang chờ duyệt.";
  const lines = list.map(item => {
    const time = new Date(item.createdAt).toLocaleString("vi-VN");
    let detail = "";
    if (item.type === "naptien") detail = ` | 💵 ${formatMoney(item.extra?.amount || 0)}`;
    return `#${item.stt} [${item.type}] ${item.userName}${detail} — ${time}`;
  });
  return `📋 Danh sách chờ duyệt (${list.length}):\n${lines.join("\n")}\n\n✅ .duyet <stt>  |  ❌ .huy <stt>`;
}

// ── Module export ──────────────────────────────────────────────────────────────
module.exports = {
  config: {
    name: "duyet",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MiZai",
    description: "Duyệt hoặc hủy yêu cầu theo số thứ tự",
    commandCategory: "Quản Trị",
    usages: ".duyet [stt] | .huy <stt>",
    cooldowns: 1
  },

  run: async ({ api, event, args, send, senderId, commandName }) => {
    const raw = event?.data ?? {};
    let adminName = senderId;
    try { adminName = await resolveSenderName({ api, userId: senderId }); } catch {}

    const isHuy = commandName === "huy";

    // Không có args → hiển thị danh sách
    if (!isHuy && (!args[0] || isNaN(Number(args[0])))) {
      const list = getPendingList();
      return send(buildPendingList(list));
    }

    const stt = Number(args[0]);
    const reason = args.slice(1).join(" ");

    const item = getRequest(stt);
    if (!item) return send(`❌ Không tìm thấy yêu cầu #${stt}.`);

    const resolved = resolveRequest(stt, isHuy ? "rejected" : "approved", senderId, reason);
    if (!resolved) return send(`❌ Không thể xử lý yêu cầu #${stt}.`);

    if (isHuy) {
      await handleReject({ api, item: resolved, adminId: senderId, adminName, reason, send });
    } else {
      await handleApprove({ api, item: resolved, adminId: senderId, adminName, reason, send });
    }
  },

  // ── onReply: Admin reply vào tin nhắn thông báo của bot ─────────────────────
  onReply: async ({ api, event, data, send }) => {
    const raw = event?.data ?? {};
    const senderId = raw?.uidFrom ? String(raw.uidFrom) : null;
    if (!senderId) return;

    // Kiểm tra quyền admin trong onReply
    const { isBotAdmin } = require('../../utils/bot/botManager');
    if (!isBotAdmin(senderId)) return;

    let adminName = senderId;
    try {
      const { resolveSenderName } = require('../../includes/database/message/infoCache');
      adminName = await resolveSenderName({ api, userId: senderId });
    } catch {}

    const body = (typeof raw.content === "string" ? raw.content : raw.content?.text) || "";
    const isHuy = body.trim().toLowerCase().startsWith(".huy") || body.trim().toLowerCase().startsWith("huy");
    const parts = body.trim().split(/\s+/);
    const reason = parts.slice(1).join(" ");

    const { stt } = data;
    const item = getRequest(stt);
    if (!item) return send(`❌ Yêu cầu #${stt} không còn trong hàng đợi.`);

    const resolved = resolveRequest(stt, isHuy ? "rejected" : "approved", senderId, reason);
    if (!resolved) return send(`❌ Không thể xử lý yêu cầu #${stt}.`);

    if (isHuy) {
      await handleReject({ api, item: resolved, adminId: senderId, adminName, reason, send });
    } else {
      await handleApprove({ api, item: resolved, adminId: senderId, adminName, reason, send });
    }
  }
};
