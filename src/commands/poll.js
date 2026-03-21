const { ThreadType } = require("zca-js");

module.exports = {
  config: {
    name: "poll",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tạo và quản lý bình chọn trong nhóm",
    commandCategory: "Nhóm",
    usages:
      "poll tao <câu hỏi> | <lựa chọn 1> | <lựa chọn 2> ...\n" +
      "poll xem <pollId>\n" +
      "poll vote <pollId> <số thứ tự>\n" +
      "poll them <pollId> <lựa chọn mới>",
    cooldowns: 5
  },

  run: async ({ api, event, args, send, isGroup, threadID }) => {
    if (!isGroup) return send("⚠️ Lệnh này chỉ dùng được trong nhóm.");

    const FLAG_MAP = { "-t": "tao", "-x": "xem", "-v": "vote", "-th": "them" };
    const sub = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

    // ── Không có sub-command → hướng dẫn ─────────────────────────────────────
    if (!sub) {
      return send(
        "📊 Lệnh Poll — Bình Chọn Nhóm\n" +
        "━━━━━━━━━━━━━━━━━━━━\n" +
        "• .poll tao|-t <câu hỏi> | <lựa chọn 1> | <lựa chọn 2> ...\n" +
        "  Tạo bình chọn mới (tối thiểu 2 lựa chọn)\n\n" +
        "• .poll xem <pollId>\n" +
        "  Xem chi tiết và kết quả bình chọn\n\n" +
        "• .poll vote <pollId> <số thứ tự>\n" +
        "  Tham gia bình chọn (số thứ tự lựa chọn: 1, 2, 3...)\n\n" +
        "• .poll them <pollId> <lựa chọn mới>\n" +
        "  Thêm lựa chọn vào poll đang có\n\n" +
        "📌 Ví dụ:\n" +
        "  .poll tao Chọn màu yêu thích? | Đỏ | Xanh | Vàng\n" +
        "  .poll vote 123 2"
      );
    }

    // ── Tạo poll ──────────────────────────────────────────────────────────────
    if (sub === "tao") {
      const rest = args.slice(1).join(" ");
      if (!rest) return send("❌ Thiếu nội dung. Dùng: .poll tao <câu hỏi> | <lựa chọn 1> | <lựa chọn 2> ...");

      const parts = rest.split("|").map(s => s.trim()).filter(Boolean);
      if (parts.length < 3) return send("❌ Cần ít nhất 1 câu hỏi và 2 lựa chọn, phân cách bằng |");

      const question = parts[0];
      const options  = parts.slice(1);

      try {
        const result = await api.createPoll(
          {
            question,
            options,
            allowMultiChoices: false,
            allowAddNewOption: true,
            hideVotePreview: false,
            isAnonymous: false
          },
          threadID
        );

        const pollId = result?.poll_id || result?.pollId || result?.id || "?";
        const optList = options.map((o, i) => `  ${i + 1}. ${o}`).join("\n");

        return send(
          `📊 Đã tạo bình chọn thành công!\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `❓ Câu hỏi: ${question}\n\n` +
          `📋 Các lựa chọn:\n${optList}\n\n` +
          `🆔 Poll ID: ${pollId}\n` +
          `💡 Dùng .poll vote ${pollId} <số thứ tự> để bình chọn`
        );
      } catch (err) {
        return send(`❌ Tạo bình chọn thất bại: ${err?.message || err}`);
      }
    }

    // ── Xem kết quả poll ──────────────────────────────────────────────────────
    if (sub === "xem") {
      const pollId = Number(args[1]);
      if (!pollId || isNaN(pollId)) return send("❌ Thiếu Poll ID. Dùng: .poll xem <pollId>");

      try {
        const detail = await api.getPollDetail(pollId);
        const question = detail?.poll?.question || "Không rõ";
        const opts = detail?.poll?.options || [];

        const optList = opts.map((o, i) =>
          `  ${i + 1}. ${o.content} — ${o.vote_count || 0} phiếu`
        ).join("\n");

        const total = opts.reduce((s, o) => s + (o.vote_count || 0), 0);
        const status = detail?.poll?.status === 2 ? "🔴 Đã kết thúc" : "🟢 Đang mở";

        return send(
          `📊 Chi Tiết Bình Chọn #${pollId}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `❓ ${question}\n\n` +
          `${optList}\n\n` +
          `📈 Tổng phiếu: ${total}\n` +
          `${status}`
        );
      } catch (err) {
        return send(`❌ Không tìm được poll: ${err?.message || err}`);
      }
    }

    // ── Bình chọn ─────────────────────────────────────────────────────────────
    if (sub === "vote") {
      const pollId  = Number(args[1]);
      const optIdx  = Number(args[2]);
      if (!pollId || isNaN(pollId)) return send("❌ Thiếu Poll ID. Dùng: .poll vote <pollId> <số thứ tự>");
      if (!optIdx  || isNaN(optIdx)) return send("❌ Thiếu số thứ tự lựa chọn.");

      try {
        const detail  = await api.getPollDetail(pollId);
        const opts    = detail?.poll?.options || [];
        const option  = opts[optIdx - 1];
        if (!option) return send(`❌ Không có lựa chọn thứ ${optIdx}. Poll này có ${opts.length} lựa chọn.`);

        await api.votePoll(pollId, option.id);
        return send(`✅ Đã bình chọn: "${option.content}" trong poll #${pollId}`);
      } catch (err) {
        return send(`❌ Bình chọn thất bại: ${err?.message || err}`);
      }
    }

    // ── Thêm lựa chọn ─────────────────────────────────────────────────────────
    if (sub === "them") {
      const pollId  = Number(args[1]);
      const newOpt  = args.slice(2).join(" ").trim();
      if (!pollId || isNaN(pollId)) return send("❌ Thiếu Poll ID. Dùng: .poll them <pollId> <lựa chọn mới>");
      if (!newOpt) return send("❌ Thiếu nội dung lựa chọn mới.");

      try {
        await api.addPollOptions({
          pollId,
          options: [{ voted: false, content: newOpt }],
          votedOptionIds: []
        });
        return send(`✅ Đã thêm lựa chọn "${newOpt}" vào poll #${pollId}`);
      } catch (err) {
        return send(`❌ Thêm lựa chọn thất bại: ${err?.message || err}`);
      }
    }

    return send(`❓ Sub-command không hợp lệ. Gõ .poll để xem hướng dẫn.`);
  }
};
