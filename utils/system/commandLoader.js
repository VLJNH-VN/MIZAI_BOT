const fs = require("fs");
const path = require("path");


/**
 * Tự động load tất cả file .js trong thư mục /commands
 * Mỗi command export dạng:
 * module.exports = {
 *   config: {
 *     name, version, hasPermssion, credits,
 *     description, commandCategory, usages, cooldowns
 *   },
 *   run: async ({ api, event, args, send }) => {}
 * }
 */
function loadCommandFromFile(filePath) {
  const file = path.basename(filePath);
  try {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);

    if (!command || typeof command !== "object") {
      logWarn(`File ${file} không export object hợp lệ`);
      return null;
    }

    if (!command.config || typeof command.run !== "function") {
      logWarn(`Command ${file} thiếu 'config' hoặc 'run'`);
      return null;
    }

    const name = String(command.config.name || "").toLowerCase().trim();
    if (!name) {
      logWarn(`Command ${file} không có 'config.name' hợp lệ`);
      return null;
    }

    // Validate config theo format Mirai-style
    const cfg = command.config || {};
    const requiredKeys = [
      "name",
      "version",
      "hasPermssion",
      "credits",
      "description",
      "commandCategory",
      "usages",
      "cooldowns"
    ];

    const missing = requiredKeys.filter((k) => cfg[k] === undefined || cfg[k] === null);
    if (missing.length) {
      logWarn(`Command ${file} thiếu config field: ${missing.join(", ")}`);
      return null;
    }

    const perm = Number(cfg.hasPermssion);
    const cooldowns = Number(cfg.cooldowns);
    if (![0, 1, 2].includes(perm)) {
      logWarn(`Command ${file} có hasPermssion không hợp lệ (chỉ 0/1/2): ${cfg.hasPermssion}`);
      return null;
    }
    if (!Number.isFinite(cooldowns) || cooldowns < 0) {
      logWarn(`Command ${file} có cooldowns không hợp lệ (>=0): ${cfg.cooldowns}`);
      return null;
    }

    // Chuẩn hoá aliases (nếu có)
    const aliases = Array.isArray(cfg.aliases)
      ? cfg.aliases.map((a) => String(a).toLowerCase().trim()).filter(Boolean)
      : [];

    return { name, aliases, command };
  } catch (err) {
    logError(`Lỗi khi load command ${file}: ${err.message}`);
    return null;
  }
}

function collectJsFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(collectJsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    logError(`Không thể đọc thư mục: ${dir} — ${err.message}`);
  }
  return results;
}

function loadCommands(commandsDir) {
  const commands = new Map();

  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
    logWarn(`Thư mục commands chưa tồn tại, đã tạo: ${commandsDir}`);
    return commands;
  }

  const files = collectJsFiles(commandsDir);

  if (files.length === 0) {
    logWarn("Không tìm thấy command nào trong thư mục /commands");
  }

  for (const filePath of files) {
    const loaded = loadCommandFromFile(filePath);
    if (!loaded) continue;

    commands.set(loaded.name, loaded.command);

    for (const alias of loaded.aliases) {
      if (commands.has(alias)) {
        logWarn(`Alias "${alias}" của command "${loaded.name}" trùng với command/alias đã tồn tại, bỏ qua.`);
      } else {
        commands.set(alias, loaded.command);
        logInfo(`  └─ alias: ${alias} → ${loaded.name}`);
      }
    }

    const rel = path.relative(commandsDir, filePath);
    logInfo(`Loaded command: ${loaded.name} (${rel})`);
  }

  logInfo(`Tổng số command đã load: ${commands.size}`);
  return commands;
}

module.exports = { loadCommands, loadCommandFromFile };

