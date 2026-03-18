

/**
 * Cho phép từng command tự "lắng nghe" mọi tin nhắn
 * bằng cách export hàm onMessage trong file lệnh.
 *
 * Ví dụ trong command:
 * module.exports.onMessage = async (ctx) => { ... };
 *
 * @param {Object} params
 * @param {Object} params.api
 * @param {Object} params.event
 * @param {Map}   params.commands
 * @param {string} params.prefix
 */
async function handleListen({ api, event, commands, prefix }) {
  if (!commands || typeof commands.forEach !== "function") return;

  for (const [commandName, command] of commands) {
    if (!command || typeof command.onMessage !== "function") continue;

    const threadID = event.threadId;
    const raw = event?.data || {};

    const send = async (message) => {
      if (!threadID) return;
      const payload =
        typeof message === "string"
          ? { msg: message, quote: raw }
          : message;

      return api.sendMessage(payload, threadID, event.type);
    };

    try {
      await command.onMessage({
        api,
        event,
        args: [],
        send,
        commands,
        prefix,
        commandName
      });
    } catch (err) {
      logError(`Lỗi onMessage của command '${commandName}': ${err?.message || err}`);
    }
  }
}

module.exports = {
  handleListen
};

