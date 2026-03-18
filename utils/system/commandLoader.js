const fs = require("fs");
const path = require("path");

function loadCommandFromFile(filePath) {
  const file = path.basename(filePath);
  try {
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);

    if (!command || typeof command !== "object") return null;
    if (!command.config || typeof command.run !== "function") return null;

    const name = String(command.config.name || "").toLowerCase().trim();
    if (!name) return null;

    const cfg = command.config || {};
    const requiredKeys = ["name", "version", "hasPermssion", "credits", "description", "commandCategory", "usages", "cooldowns"];
    const missing = requiredKeys.filter(k => cfg[k] === undefined || cfg[k] === null);
    if (missing.length) {
      logWarn(`[CMD] ${file} thiếu config: ${missing.join(", ")}`);
      return null;
    }

    const perm = Number(cfg.hasPermssion);
    const cooldowns = Number(cfg.cooldowns);
    if (![0, 1, 2].includes(perm)) {
      logWarn(`[CMD] ${file} hasPermssion không hợp lệ (0/1/2): ${cfg.hasPermssion}`);
      return null;
    }
    if (!Number.isFinite(cooldowns) || cooldowns < 0) {
      logWarn(`[CMD] ${file} cooldowns không hợp lệ: ${cfg.cooldowns}`);
      return null;
    }

    const aliases = Array.isArray(cfg.aliases)
      ? cfg.aliases.map(a => String(a).toLowerCase().trim()).filter(Boolean)
      : [];

    return { name, aliases, command };
  } catch (err) {
    logError(`[CMD] Lỗi load ${file}: ${err.message}`);
    return null;
  }
}

function collectJsFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results = results.concat(collectJsFiles(fullPath));
      else if (entry.isFile() && entry.name.endsWith(".js")) results.push(fullPath);
    }
  } catch (err) {
    logError(`[CMD] Không đọc được thư mục: ${dir} — ${err.message}`);
  }
  return results;
}

function loadCommands(commandsDir) {
  const commands = new Map();

  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
    logWarn(`[CMD] Thư mục commands chưa tồn tại, đã tạo: ${commandsDir}`);
    return commands;
  }

  const files = collectJsFiles(commandsDir);
  if (files.length === 0) {
    logWarn("[CMD] Không tìm thấy command nào");
    return commands;
  }

  for (const filePath of files) {
    const loaded = loadCommandFromFile(filePath);
    if (!loaded) continue;

    commands.set(loaded.name, loaded.command);

    for (const alias of loaded.aliases) {
      if (!commands.has(alias)) commands.set(alias, loaded.command);
    }
  }

  logInfo(`Loaded command: ${commands.size}`);
  return commands;
}

async function runOnLoad(commands, api) {
  if (!commands || !api) return;
  const seen = new Set();
  for (const [, command] of commands) {
    if (!command || seen.has(command)) continue;
    seen.add(command);
    if (typeof command.onLoad !== "function") continue;
    try {
      await command.onLoad({ api, commands });
    } catch (err) {
      const name = command?.config?.name || "unknown";
      logError(`[CMD] Lỗi onLoad của '${name}': ${err?.message || err}`);
    }
  }
}

module.exports = { loadCommands, loadCommandFromFile, runOnLoad };
