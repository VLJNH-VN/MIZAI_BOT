const fs = require("fs");
const path = require("path");
const { loadCommands, loadCommandFromFile } = require("../../utils/system/loader");

function listJsFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  } catch {
    return [];
  }
}

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}

function replaceCommandsInPlace(targetMap, sourceMap) {
  targetMap.clear();
  for (const [k, v] of sourceMap.entries()) targetMap.set(k, v);
}

module.exports = {
  config: {
    name: "cmd",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "MiZai",
    description: "Reload command không cần restart bot",
    commandCategory: "System",
    usages: "cmd load <tenlenh> | cmd loadAll",
    cooldowns: 0
  },

  run: async ({ args, send, commands }) => {
    const commandsDir = __dirname; // .../commands

    const sub = normalizeName(args[0]);
    if (!sub) {
      await send(
        `Dùng:\n` +
          `- cmd load <tenlenh>\n` +
          `- cmd loadAll\n` +
          `Hiện có: ${Array.from(commands.keys()).sort().join(", ")}`
      );
      return;
    }

    // cmd loadAll
    if (sub === "loadall" || sub === "load-all") {
      const before = commands.size;
      const loaded = loadCommands(commandsDir);
      replaceCommandsInPlace(commands, loaded);
      await send(`Đã reload ALL commands: ${before} -> ${commands.size}`);
      return;
    }

    // cmd load <tenlenh>
    if (sub === "load" || sub === "reload") {
      const nameArg = args[1];
      const targetName = normalizeName(nameArg);
      if (!targetName) {
        await send("Thiếu tên lệnh. Ví dụ: cmd load ping");
        return;
      }

      // 1) Thử theo filename: <name>.js
      const byFile = path.join(commandsDir, `${targetName}.js`);
      let loaded = fs.existsSync(byFile) ? loadCommandFromFile(byFile) : null;

      // 2) Thử match theo base filename (case-insensitive)
      if (!loaded) {
        const files = listJsFiles(commandsDir);
        const match = files.find((f) => normalizeName(path.parse(f).name) === targetName);
        if (match) loaded = loadCommandFromFile(path.join(commandsDir, match));
      }

      // 3) Fallback: scan all, match theo config.name
      if (!loaded) {
        const files = listJsFiles(commandsDir);
        for (const f of files) {
          const p = path.join(commandsDir, f);
          const tmp = loadCommandFromFile(p);
          if (tmp && tmp.name === targetName) {
            loaded = tmp;
            break;
          }
        }
      }

      if (!loaded) {
        await send(
          `Không load được lệnh '${targetName}'.\n` +
            `Hiện có: ${Array.from(commands.keys()).sort().join(", ")}`
        );
        return;
      }

      commands.set(loaded.name, loaded.command);
      await send(`Đã reload command '${loaded.name}' (v${loaded.command.config?.version || "?"}).`);
      return;
    }

    await send(
      `Subcommand không hợp lệ: '${args[0]}'.\n` +
        `Dùng: cmd load <tenlenh> | cmd loadAll`
    );
  }
};

