"use strict";

/**
 * utils/bot/sendCustomSticker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Đăng ký hàm sendCustomSticker lên api object (dùng api.custom của zca-js).
 *
 * Cách dùng:
 *   global.registerCustomSticker(api)
 *   await api.sendCustomSticker({ staticImgUrl, animationImgUrl, threadId, threadType })
 *
 * Endpoint theo Python zlapi FCA:
 *   User  → https://tt-files-wpa.chat.zalo.me/api/message/photo_url
 *   Group → https://tt-files-wpa.chat.zalo.me/api/group/photo_url
 */

const { ThreadType }                   = require("zca-js");
const { logWarn }                      = require("../system/logger");

function registerCustomSticker(api) {
  if (api.sendCustomSticker) return;
  try {
    api.custom("sendCustomSticker", async ({ ctx, utils, props }) => {
      const { staticImgUrl, animationImgUrl, threadId, threadType } = props;
      const isGroup = threadType === ThreadType.Group;

      const endpoint = isGroup
        ? "https://tt-files-wpa.chat.zalo.me/api/group/photo_url"
        : "https://tt-files-wpa.chat.zalo.me/api/message/photo_url";

      const serviceURL = utils.makeURL(endpoint, {
        zpw_ver : 645,
        zpw_type: 30,
        nretry  : 0,
      });

      const width  = 512;
      const height = 512;

      const payload = {
        clientId    : Date.now(),
        title       : "",
        oriUrl      : staticImgUrl,
        thumbUrl    : staticImgUrl,
        hdUrl       : staticImgUrl,
        width,
        height,
        properties  : JSON.stringify({
          subType: 0,
          color  : -1,
          size   : -1,
          type   : 3,
          ext    : JSON.stringify({ sSrcStr: "@STICKER", sSrcType: 0 }),
        }),
        contentId   : Date.now(),
        thumb_height: width,
        thumb_width : height,
        webp        : JSON.stringify({
          width,
          height,
          url: animationImgUrl || staticImgUrl,
        }),
        zsource     : -1,
        ttl         : 0,
      };

      if (isGroup) {
        payload.visibility = 0;
        payload.grid       = String(threadId);
      } else {
        payload.toId = String(threadId);
      }

      const encryptedParams = utils.encodeAES(JSON.stringify(payload));
      if (!encryptedParams) throw new Error("Failed to encrypt params");

      const response = await utils.request(serviceURL, {
        method: "POST",
        body  : new URLSearchParams({ params: encryptedParams }),
      });
      return utils.resolve(response);
    });
  } catch (e) {
    logWarn("[sendCustomSticker] Không thể đăng ký:", e.message);
  }
}

module.exports = { registerCustomSticker };
