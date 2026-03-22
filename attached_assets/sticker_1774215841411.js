/**
 * Module: Sticker
 * Tạo sticker (ảnh động/tĩnh) khi reply vào một ảnh hoặc video
 * Dựa trên logic Python cung cấp
 */

import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import axios from "axios";
import FormData from "form-data";
import querystring from "node:querystring";
import { log } from "../logger.js";
import ffmpegPath from "ffmpeg-static";

const execPromise = promisify(exec);

export const name = "sticker";
export const description = "Tạo sticker từ ảnh, GIF, video (Reply + !stk)";

async function getFileType(url) {
    try {
        const response = await axios.head(url, { timeout: 5000 });
        const contentType = (response.headers["content-type"] || "").toLowerCase();
        if (contentType.includes("video") || contentType.includes("gif")) return "video";
        if (contentType.includes("image")) return "image";
        return "unknown";
    } catch (e) {
        return "unknown";
    }
}

async function uploadToCatbox(filePath) {
    try {
        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", fs.createReadStream(filePath), "sticker.webp");

        log.info("◈ Đang upload lên Catbox...");
        const response = await axios.post("https://catbox.moe/user/api.php", form, {
            headers: form.getHeaders(),
            timeout: 30000
        });

        if (response.status === 200 && typeof response.data === "string" && response.data.startsWith("http")) {
            log.info(`✅ [Catbox] Upload thành công: ${response.data}`);
            return response.data;
        }
        return null;
    } catch (e) {
        log.error("Lỗi khi upload lên Catbox:", e.message);
        return null;
    }
}

async function convertToWebp(inputPath, outputPath, isAnimated) {
    try {
        let cmd = "";
        if (isAnimated) {
            // Chuyển đổi Video/GIF -> Animated WebP
            cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vcodec libwebp -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -loop 0 -preset default -an -vsync 0 -q:v 60 "${outputPath}"`;
        } else {
            // Chuyển đổi Ảnh -> Static WebP
            cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vcodec libwebp -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -q:v 80 "${outputPath}"`;
        }

        await execPromise(cmd);
        return true;
    } catch (e) {
        log.error("Lỗi FFmpeg:", e.stderr || e.message);
        return false;
    }
}

async function reply(ctx, text) {
    await ctx.api.sendMessage({ msg: text, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

export const commands = {
    stk: async (ctx) => {
        const { api, threadId, threadType, message } = ctx;

        if (!message.data.quote) {
            return reply(ctx, "⚠️ Hãy reply (phản hồi) vào một ảnh hoặc video để tạo sticker.");
        }

        let attach;
        try {
            const quoteAttach = message.data.quote.attach;
            attach = typeof quoteAttach === "string" ? JSON.parse(quoteAttach) : quoteAttach;
        } catch (e) {
            return reply(ctx, "⚠️ Dữ liệu đính kèm không hợp lệ.");
        }

        if (!attach) return reply(ctx, "⚠️ Không tìm thấy tệp đính kèm nào được reply.");

        let mediaUrl = attach.hdUrl || attach.href || attach.url || attach.thumbnail || attach.thumbUrl;
        if (!mediaUrl) return reply(ctx, "⚠️ Không tìm thấy URL của tệp.");

        mediaUrl = decodeURIComponent(mediaUrl.replace(/\\\//g, "/"));
        const fileType = await getFileType(mediaUrl);

        if (fileType === "unknown") {
            return reply(ctx, "⚠️ Định dạng không được hỗ trợ (chỉ Ảnh/Video/GIF).");
        }

        // Reaction hiệu ứng chờ
        const clocks = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (message.data) {
                api.addReaction({ icon: clocks[clockIdx++ % 12], rType: 75, source: 1 }, {
                    data: { msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId },
                    threadId, type: threadType
                }).catch(() => { });
            }
        }, 1500);

        const tempInput = path.join(process.cwd(), `stk_in_${Date.now()}.tmp`);
        const tempOutput = path.join(process.cwd(), `stk_out_${Date.now()}.webp`);

        try {
            // Tải media
            const resp = await axios({ url: mediaUrl, method: "GET", responseType: "stream", timeout: 20000 });
            const writer = fs.createWriteStream(tempInput);
            resp.data.pipe(writer);
            await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

            // Chuyển đổi sang WebP (Animated nếu là video/gif)
            const isAnimated = fileType === "video";
            const ok = await convertToWebp(tempInput, tempOutput, isAnimated);
            if (!ok) throw new Error("Chuyển đổi sang WebP thất bại.");

            // Upload Catbox
            const webpUrl = await uploadToCatbox(tempOutput);
            if (!webpUrl) throw new Error("Lỗi khi tải sticker lên hosting (Catbox).");

            // Gửi sticker
            await api.sendCustomSticker({
                staticImgUrl: webpUrl,
                animationImgUrl: isAnimated ? webpUrl : undefined,
                threadId,
                threadType,
                width: 512,
                height: 512
            });

        } catch (e) {
            log.error("Lỗi STK:", e.message);
            await reply(ctx, `⚠️ Lỗi: ${e.message}`);
        } finally {
            clearInterval(reactionInterval);
            if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
            if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
        }
    },

    pstk: async (ctx) => {
        const { api, threadId, threadType, args, message } = ctx;
        const query = args.join(" ");

        if (!query) {
            return api.sendMessage("⚠️ Vui lòng nhập từ khóa để tìm sticker trên Pinterest!\nVí dụ: !pstk mèo cute", threadId, threadType);
        }

        // Hiện hiệu ứng chờ
        const clocks = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (message.data) {
                api.addReaction({ icon: clocks[clockIdx++ % 12], rType: 75, source: 1 }, {
                    data: { msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId },
                    threadId, type: threadType
                }).catch(() => { });
            }
        }, 1500);

        try {
            // 1. Tìm kiếm trên Pinterest (Dùng cookie và header đầy đủ để tránh 403)
            const CSRF = '6044a8a6c65d538760e70c78b3c82bd0';
            const PINTEREST_COOKIE = `csrftoken=${CSRF}; ar_debug=1; _routing_id="26362549-c12f-4ef0-ad1a-46db9831079e"; sessionFunnelEventLogged=1; _auth=1; _pinterest_sess=TWc9PSZ1RWUyRGQrWVRsSzdacUVIaU9VQkZoWGZlUGkxcnh4SmhGTmpoSkdlNm8vckg3QXBjV2swV0VDbDEvaTFuMUx4UUlVUVlKRUwvbVp4aWJGcnlhVDg2QmNFT0hPaG9NdWxsVGlNNUtvbDg1THE0Kyt0OFZJdGwxYkFpOVZbzFodEFDYTE1c0lMUFpRTHB2OGowN1JidVBxanQrdkxGWEZwc3pqRGdNZm5CWDFDYWlLakE1UUFWQXhuNWtzdjVCR0Q0UjB6LzlHa05BcHh6amhzcTc0WmNLaGdteDRxTFJPU3ZFTElHNS84WTVkOGtxc0ZPNUNWYnRMTHVOdk8vTXN5eFRuWWVJeWo3ZUdhWHZFek9abUQ4eWZBTHZtZTdta0dmdzJXcUp5d08zTVdobEE2NU92akJkeUE4bVVFRmVMZkRnRVpVSU84Y1k1bFh4ZHAzRklTVVlobGwvQzFmN2Q0U2FGTFRlWHVYS3BTbVIwWFd0a3NrMmRXZXdRMEs3MHZSbnd4aTVuRWl6aUFNckwwM2tya29RRXNMaElRQ29mM3l5aWlGSmJHczZvR2RkdjhzaTl6TGF0R1h2TnpUNG5Yb3p4ZkdpMWtHaTRlRjlLSzdsR3lpZXJpRUZRSGt0dFVOaFBaY0taY2h6bS9JTFc1RzE2TEV0UzZlZTJWdEZsNWJkRmk0aFlVVysvcGtVVzU4d1NtelN5VmY5cTlya1EzMVNoNFJTdHJXdmgwNm5qSkZFMk90bmw4bnQyeXdPU086U0pJWm1SUGdqb3BYa1pxWkE5Vk9mUm5DWW96YTBrdFZKZ2g4V1hEcEZwU3JBK3V5YmhxenkzZ3VkZmN1ZXlKOXBpOUtwT1d5QVg3bHhrMjBmaWl6L3JtRHFWUWprZ3FGWUY0K3JDQUd0aXFjSGYzYUFKY3JsYnJLa29NT3ZITTkzaWl0enFjeE9lMkhTbXh5amVYL0ZFaFY0cEJJbnNlZGd1Ry9hS3R3c3N4YXMwSGxCZkRzY3djY0sxUGxOVWJPQk5TaUdxWS93Rmp1SWo4dDVENE1yL2lWUjRUQnJ1cUw1dWxjbzgxN3VuK01PalhlQWFPbWZ6K0VMRm1GdUdYR1dwUVVSUVJMS3ZzaWNVMDd2TERoVHoyWUZqVDEzdVRqNEpkZjZoVCtpcnlwV09VYUc5Z0hyOGZUbS9mQWZ1R1lOYzQ0d0FzUHlWVmRodWRGK0NiaU0ycjhVNklheHNKZ0FIbHg5VE41ajlpVWVoNnUycXFzNk5uOGdBRUdSYzZoRXBqMElaTjVYQTIyVTNtS3QwdjdHVDA4TUNTcm9XdEx6QzN1ajZMM2pkQkpKTXIrZWpvcXQ4REZiYkVsdlNPd2V0T1puRUdpUFpGSnh1T00vczlCWjV5VEtIQ3IzWDdneXZmREJlNHVUTTIwSkVEOWQ3cUdBYnlRT3diTFhNVEJkQysyTzUwMFlRL01td1JHN2JlZkM3Y1RnNnVZSjJPOUI5QXl6a2hncUFKVnZ5UG9SVHpZUU9HMGFGMGJvTHllcjNLaFRlTTN4cDZnZzhvT1NmVXR5VlBEMmJFUGI4TjVjMDB1b0VnUUdHcGUvMFFITnM1SkJ3d1ZMRHBIRU9aczc2QjhkNVZkQU1tNHBnK05Fdy93YjlXNkVLL3BwSE9TeUtsY0oyM2YvM0AbSEJNUWZVcTIrcUdJRDNsQTV3WEFlQmNwd2VyZnZKQ0NUaWhYUnV4NUt6UjBTYW9oL051L2NuRURheEpMRElMdlhFbS9SeVMzMkUmc0NoSFhDWTk2Q2ZLelltOXNGWDFack1LcEhVPQ==; __Secure-s_a=Y1QvZ05nSmNURGdxemx6L1UwOUFkUTFsYVB1eEgwK2lEbHJMZXNzeW80SjZqMXhoazVVUVZVRVFaWkpOWWRSS3JjZFBCQW5rb1NCRE15djFDS3FIVDE1WUdDL0Z6UkdFMW1kcVBKYndnTVA0dUN4bDVOVzhod0E0TmlGSlhCYkpzYVdwWFNTRUxpbkk3bDFDamp2UG5UY0szd0pmMy9wbFlzYkJnWEpYRkdmN2FaT2Z5bFA1aUgybG1OYTlqamw5RmZtL1RmQzlNcmkwQXZGZkRtWlVqM1N2M29LV3RYRnVmNSs4ZU5odjVYRTRDWkZRRHkwZ1VLbXhMZUVicFpBT0EvbHVWL0hyeDhuOC85RmxBd0lTSEZvQVVLSkpXNWNFNnhoWWFFbVBiNmxxR3MzM0V6Rjl1TjV6RlJQa3hkdGFjeWVkOFN4ZmRobkZCeUJ3d2xkR0hmKzRmWkw3TFAwc08xc0wvbS9XL3drbmVVdjJtUmV5M1hRYUpmLzJsQnNWWStEUmt5T28rYU1zQ0gyY1F2djJ6V1Z2anovcGlydVVYc2xjK2IzR2xNTnI4cmNobkZXL2szSTFka01LWUE5ckxOS0NmclNDSHRoTTlObzFMTk1YNGRHZnJoVmlXYVQxdElOelJERW5sNm5Sc2hoYXB3b2lmVzJDd0ZqWUlqWjExOUtYZjVsRW42Z2U2YnBkMDdXb2VBU2duV2NxaVRJOC93azE4TytMK0hWM3FrRmJZOUNhMXZ3MXZoa2lNeHg4OUQ2SGlERm1CczhJQkp0RERDZERxMWF5aFV5QlFTSERYN09vbWEwaUxLTVV6VzZ1anhYbUJtbG4zcDRqNVJ6SEZTTXFaT0lna00rQUFCZkt0VWp1UEFWVjVPY3cySUpYbU5CTHVHaGxWNit0dFF5QVpHY09nTVduOVZTY2IvblJDeUcrV3dWZG9qNlRSQ3cxcVhSTDBRbWxINGZtZVNkaE41R1djMzdjbjBhbzJCa2kxVk85SVlIeXlSSW9QNndmY2VqWjFzUXoyaFZPYVNnUXF6dm1SbWZWa0ttTk5hRWFqV0FtYWVNYkgzM0s1Q1BNVGd0Szdwb2pIcWJ5eS94QXVMTkZ6VHNRdlNUQmFGeUVpbDFkY1VTa3A1RHhwWHkyNzgvM0RFTnplUnk3Y0l1R01yQjhFVHAxU2Q2R2NjRVlhTUs1TWoycXozMGdGZ084TDVmbXBYVXBQVHVPTXNQaHVLVWdzeWFld3drTTZtNWRvcjJ5bmU5WExwR1B0V3NkNFVEY2VvQzB1QzVkUDJVVU40L00rNGhpNWtLcHl5U2ZMWFBVM3ZtYWtaQT0mU09YaVFnRExQMi9XRWNxRFJMSHA1NkIzaE80PQ==; _b="AYovPepp2ENJH6lC2RgyOsJvWs+laEqNVOhdITARklV8PlbhotyboglDk79sjQRzsm4="`;

            const searchUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/`;
            const postData = {
                source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
                data: JSON.stringify({
                    options: { query: query, scope: "pins", redux_normalize_feed: true },
                    context: {}
                })
            };

            const res = await axios.post(searchUrl, querystring.stringify(postData), {
                headers: {
                    'Accept': 'application/json, text/javascript, */*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': PINTEREST_COOKIE,
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': CSRF,
                    'X-Pinterest-AppState': 'active',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
                }
            });

            const results = res.data?.resource_response?.data?.results || [];
            if (results.length === 0) throw new Error("Không tìm thấy hình ảnh nào.");

            // Lấy 5 ảnh đầu tiên để làm sticker
            const pins = results.slice(0, 5);
            await api.sendMessage(`🔍 Đang tạo ${pins.length} sticker từ Pinterest cho từ khóa "${query}"...`, threadId, threadType);

            for (const pin of pins) {
                const imageUrl = pin.images?.orig?.url || pin.images?.['736x']?.url || pin.images?.['474x']?.url;
                if (!imageUrl) continue;

                const tempIn = path.join(process.cwd(), `pstk_in_${Date.now()}.tmp`);
                const tempOut = path.join(process.cwd(), `pstk_out_${Date.now()}.webp`);

                try {
                    // Tải và Convert
                    const imgResp = await axios({ url: imageUrl, method: "GET", responseType: "stream", timeout: 10000 });
                    const writer = fs.createWriteStream(tempIn);
                    imgResp.data.pipe(writer);
                    await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

                    const ok = await convertToWebp(tempIn, tempOut, false);
                    if (!ok) continue;

                    const webpUrl = await uploadToCatbox(tempOut);
                    if (!webpUrl) continue;

                    // Gửi Sticker
                    await api.sendCustomSticker({
                        staticImgUrl: webpUrl,
                        threadId,
                        threadType,
                        width: 512,
                        height: 512
                    });
                } catch (err) {
                    log.error("Lỗi tạo PSTK con:", err.message);
                } finally {
                    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                }
            }

        } catch (e) {
            log.error("Lỗi PSTK:", e.message);
            await api.sendMessage(`⚠️ Lỗi: ${e.message}`, threadId, threadType);
        } finally {
            clearInterval(reactionInterval);
        }
    },

    spin: async (ctx) => {
        // Alias cho !stk spin [keyword]
        const { args } = ctx;
        if (args[0] === "spin") {
            ctx.args = args.slice(1);
            return commands.stk_spin(ctx);
        }
        return commands.stk(ctx);
    },

    stk_spin: async (ctx) => {
        const { api, threadId, threadType, args, message } = ctx;
        const query = args.join(" ");

        if (!query) {
            return api.sendMessage("⚠️ Vui lòng nhập từ khóa để spin sticker!\nVí dụ: -stk spin mèo", threadId, threadType);
        }

        const clocks = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (message.data) {
                api.addReaction({ icon: clocks[clockIdx++ % 12], rType: 75, source: 1 }, {
                    data: { msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId },
                    threadId, type: threadType
                }).catch(() => { });
            }
        }, 1500);

        try {
            const CSRF = '6044a8a6c65d538760e70c78b3c82bd0';
            const PINTEREST_COOKIE = `csrftoken=${CSRF}; ar_debug=1; _routing_id="26362549-c12f-4ef0-ad1a-46db9831079e"; sessionFunnelEventLogged=1; _auth=1; _pinterest_sess=TWc9PSZ1RWUyRGQrWVRsSzdacUVIaU9VQkZoWGZlUGkxcnh4SmhGTmpoSkdlNm8vckg3QXBjV2swV0VDbDEvaTFuMUx4UUlVUVlKRUwvbVp4aWJGcnlhVDg2QmNFT0hPaG9NdWxsVGlNNUtvbDg1THE0Kyt0OFZJdGw3dVBBUEU0VHViMXdBaTlZbzFodEFDYTE1c0lMUFpRTHB2OGowN1JidVBxanQrdkxGWEZwc3pqRGdNZm5CWDFDYWlLakE1UUFWQXhuNWtzdjVCR0Q0UjB6LzlHa05BcHh6amhzcTc0WmNLaGdteDRxTFJPU3ZFTElHNS84WTVkOGtxc0ZPNUNWYnRMTHVOdk8vTXN5eFRuWWVJeWo3ZUdhWHZFek9abUQ4eWZBTHZtZTdta0dmdzJXcUp5d08zTVdobEE2NU92akJkeUE4bVVFRmVMZkRnRVpVSU84Y1k1bFh4ZHAzRklTVVlobGwvQzFmN2Q0U2FGTFRlWHVYS3BTbVIwWFd0a3NrMmRXZXdRMEs3MHZSbnd4aTVuRWl6aUFNckwwM2tya29RRXNMaElRQ29mM3l5aWlGSmJHczZvR2RkdjhzaTl6TGF0R1h2TnpUNG5Yb3p4ZkdpMWtHaTRlRjlLSzdsR3lpZXJpRUZRSGt0dFVOaFBaY0taY2h6bS9JTFc1RzE2TEV0UzZlZTJWdEZsNWJkRmk0aFlVVysvcGtVVzU4d1NtelN5VmY5cTlya1EzMVNoNFJTdHJXdmgwNm5qSkZFMk90bmw4bnQyeXdPU086U0pJWm1SUGdqb3BYa1pxWkE5Vk9mUm5DWW96YTBrdFZKZ2g4V1hEcEZwU3JBK3V5YmhxenkzZ3VkZmN1ZXlKOXBpOUtwT1d5QVg3bHhrMjBmaWl6L3JtRHFWUWprZ3FGWUY0K3JDQUd0aXFjSGYzYUFKY3JsYnJLa29NT3ZITTkzaWl0enFjeE9lMkhTbXh5amVYL0ZFaFY0cEJJbnNlZGd1Ry9hS3R3c3N4YXMwSGxCZkRzY3djY0sxUGxOVWJPQk5TaUdxWS93Rmp1SWo4dDVENE1yL2lWUjRUQnJ1cUw1dWxjbzgxN3VuK01PalhlQWFPbWZ6K0VMRm1GdUdYR1dwUVVSUVJMS3ZzaWNVMDd2TERoVHoyWUZqVDEzdVRqNEpkZjZoVCtpcnlwV09VYUc5Z0hyOGZUbS9mQWZ1R1lOYzQ0d0FzUHlWVmRodWRGK0NiaU0ycjhVNklheHNKZ0FIbHg5VE41ajlpVWVoNnUycXFzNk5uOGdBRUdSYzZoRXBqMElaTjVYQTIyVTNtS3QwdjdHVDA4TUNTcm9XdEx6QzN1ajZMM2pkQkpKTXIrZWpvcXQ4REZiYkVsdlNPd2V0T1puRUdpUFpGSnh1T00vczlCWjV5VEtIQ3IzWDdneXZmREJlNHVUTTIwSkVEOWQ3cUdBYnlRT3diTFhNVEJkQysyTzUwMFlRL01td1JHN2JlZkM3Y1RnNnVZSjJPOUI5QXl6a2hncUFKVnZ5UG9SVHpZUU9HMGFGMGJvTHllcjNLaFRlTTN4cDZnZzhvT1NmVXR5VlBEMmJFUGI4TjVjMDB1b0VnUUdHcGUvMFFITnM1SkJ3d1ZMRHBIRU9aczc2QjhkNVZkQU1tNHBnK05Fdy93YjlXNkVLL3BwSE9TeUtsY0oyM2YvM0AbSEJNUWZVcTIrcUdJRDNsQTV3WEFlQmNwd2VyZnV6NkNoSFhDWTk2Q2ZLelltOXNGWDFack1LcEhVPQ==; __Secure-s_a=Y1QvZ05nSmNURGdxemx6L1UwOUFkUTFsYVB1eEgwK2lEbHJMZXNzeW80SjZqMXhoazVVUVZVRVFaWkpOWWRSS3JjZFBCQW5rb1NCRE15djFDS3FIVDE1WUdDL0Z6UkdFMW1kcVBKYndnTVA0dUN4bDVOVzhod0E0TmlGSlhCYkpzYVdwWFNTRUxpbkk3bDFDamp2UG5UY0szd0pmMy9wbFlzZkJnWEpYRkdmN2FaT2Z5bFA1aUgybG1OYTlqamw5RmZtL1RmQzlNcmkwQXZGZkRtWlVqM1N2M29LV3RYRnVmNSs4ZU5odjVYRTRDWkZRRHkwZ1VLbXhMZUVicFpBT0EvbHVWL0hyeDhuOC85RmxBd0lTSEZvQVVLSkpXNWNFNnhoWWFFbVBiNmxxR3MzM0V6Rjl1TjV6RlJQa3hkdGFjeWVkOFN4ZmRobkZCeUJ3d2xkR0hmKzRmWkw3TFAwc08xc0wvbS9XL3drbmVVdjJtUmV5M1hRYUpmLzJsQnNWWStEUmt5T28rYU1zQ0gyY1F2djJ6V1Z2anovcGlydVVYc2xjK2IzR2xNTnI4cmNobkZXL2szSTFka01LWUE5ckxOS0NmclNDSHRoTTlObzFMTk1YNGRHZnJoVmlXYVQxdElOelJERW5sNm5Sc2hoYXB3b2lmVzJDd0ZqWUlqWjExOUtYZjVsRW42Z2U2YnBkMDdXb2VBU2duV2NxaVRJOC93azE4TytMK0hWM3FrRmJZOUNhMXZ3MXZoa2lNeHg4OUQ2SGlERm1CczhJQkp0RERDZERxMWF5aFV5QlFTSERYN09vbWEwaUxLTVV6VzZ1anhYbUJtbG4zcDRqNVJ6SEZTTXFaT0lna00rQUFCZkt0VWp1UEFWVjVPY3cySUpYbU5CTHVHaGxWNit0dFF5QVpHY09nTVduOVZTY2IvblJDeUcrV3dWZG9qNlRSQ3cxcVhSTDBRbWxINGZtZVNkaE41R1djMzdjbjBhbzJDa2kxVk85SVlIeXlSSW9QNndmY2VqWjFzUXoyaFZPYVNnUXF6dm1SbWZWa0ttTk5hRWFqV0FtYWVNYkgzM0s1Q1BNVGd0Szdwb2pIcWJ5eS94QXVMTkZ6VHNRdlNUQmFGeUVpbDFkY1VTa3A1RHhwWHkyNzgvM0RFTnplUnk3Y0l1R01yQjhFVHAxU2Q2R2NjRVlhTUs1TWoycXozMGdGZ084TDVmbXBYVXBQVHVPTXNQaHVLVWdzeWFld3drTTZtNWRvcjJ5bmU5WExwR1B0V3NkNFVEY2VvQzB1QzVkUDJVVU40L00rNGhpNWtLcHl5U2ZMWFBVM3ZtYWtaQT0mU09YaVFnRExQMi9XRWNxRFJMSHA1NkIzaE80PQ==; _b="AYovPepp2ENJH6lC2RgyOsJvWs+laEqNVOhdITARklV8PlbhotyboglDk79sjQRzsm4="`;

            const searchUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/`;
            const postData = {
                source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
                data: JSON.stringify({
                    options: { query: query, scope: "pins", redux_normalize_feed: true },
                    context: {}
                })
            };

            const res = await axios.post(searchUrl, querystring.stringify(postData), {
                headers: {
                    'Accept': 'application/json, text/javascript, */*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': PINTEREST_COOKIE,
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': CSRF,
                    'X-Pinterest-AppState': 'active',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
                }
            });

            const results = res.data?.resource_response?.data?.results || [];
            if (results.length === 0) throw new Error("Không tìm thấy hình ảnh nào.");

            // Pick 1 random pin for the "spin" feel
            const pin = results[Math.floor(Math.random() * Math.min(results.length, 20))];
            const imageUrl = pin.images?.orig?.url || pin.images?.['736x']?.url || pin.images?.['474x']?.url;

            if (!imageUrl) throw new Error("Không lấy được link ảnh.");

            const tempIn = path.join(process.cwd(), `spin_in_${Date.now()}.tmp`);
            const tempOut = path.join(process.cwd(), `spin_out_${Date.now()}.webp`);

            try {
                const imgResp = await axios({ url: imageUrl, method: "GET", responseType: "stream", timeout: 10000 });
                const writer = fs.createWriteStream(tempIn);
                imgResp.data.pipe(writer);
                await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

                const ok = await convertToWebp(tempIn, tempOut, false);
                if (!ok) throw new Error("Ghi chuẩn sticker lỗi.");

                const webpUrl = await uploadToCatbox(tempOut);
                if (!webpUrl) throw new Error("Hosting lỗi.");

                await api.sendCustomSticker({
                    staticImgUrl: webpUrl,
                    threadId,
                    threadType,
                    width: 512,
                    height: 512
                });
            } finally {
                if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
            }

        } catch (e) {
            log.error("Lỗi STK SPIN:", e.message);
            api.sendMessage(`⚠️ Lỗi: ${e.message}`, threadId, threadType);
        } finally {
            clearInterval(reactionInterval);
        }
    },

    customstk: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        const url = args[0];

        if (!url || !url.startsWith("http")) {
            return api.sendMessage("⚠️ Vui lòng cung cấp link ảnh/video để làm sticker!\nVí dụ: -customstk https://example.com/anh.jpg", threadId, threadType);
        }

        try {
            await api.sendMessage("🔍 Đang xử lý sticker từ link...", threadId, threadType);

            const fileType = await getFileType(url);
            const isAnimated = fileType === "video" || url.toLowerCase().includes(".gif");

            const tempIn = path.join(process.cwd(), `cstk_in_${Date.now()}.tmp`);
            const tempOut = path.join(process.cwd(), `cstk_out_${Date.now()}.webp`);

            // Tải về
            const resp = await axios({ url, method: "GET", responseType: "stream", timeout: 20000 });
            const writer = fs.createWriteStream(tempIn);
            resp.data.pipe(writer);
            await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

            // Chuyển đổi
            const ok = await convertToWebp(tempIn, tempOut, isAnimated);
            if (!ok) throw new Error("Không thể chuyển đổi file này thành sticker.");

            // Upload
            const webpUrl = await uploadToCatbox(tempOut);
            if (!webpUrl) throw new Error("Lỗi upload sticker.");

            // Gửi
            await api.sendCustomSticker({
                staticImgUrl: webpUrl,
                animationImgUrl: isAnimated ? webpUrl : undefined,
                threadId,
                threadType,
                width: 512,
                height: 512
            });

            if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
            if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
        } catch (e) {
            log.error("Lỗi CSTK:", e.message);
            api.sendMessage(`⚠️ Lỗi: ${e.message}`, threadId, threadType);
        }
    },

    aistk: async (ctx) => {
        const { api, threadId, threadType, args, message } = ctx;
        const prompt = args.join(" ");

        if (!prompt) {
            return api.sendMessage("⚠️ Vui lòng nhập mô tả để AI vẽ sticker!\nVí dụ: -aistk mèo phi hành gia", threadId, threadType);
        }

        const clocks = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (message.data) {
                api.addReaction({ icon: clocks[clockIdx++ % 12], rType: 75, source: 1 }, {
                    data: { msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId },
                    threadId, type: threadType
                }).catch(() => { });
            }
        }, 1500);

        try {
            await api.sendMessage(`🎨 AI đang vẽ sticker: "${prompt}"... (Đợi xíu nha)`, threadId, threadType);

            // Sử dụng Pollinations AI (Miễn phí, không cần key, cực nhanh)
            const aiImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;

            const tempIn = path.join(process.cwd(), `ai_in_${Date.now()}.tmp`);
            const tempOut = path.join(process.cwd(), `ai_out_${Date.now()}.webp`);

            try {
                const imgResp = await axios({ url: aiImageUrl, method: "GET", responseType: "stream", timeout: 30000 });
                const writer = fs.createWriteStream(tempIn);
                imgResp.data.pipe(writer);
                await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

                // Chuyển sang WebP chuẩn sticker
                const ok = await convertToWebp(tempIn, tempOut, false);
                if (!ok) throw new Error("Vẽ xong nhưng đóng gói sticker lỗi.");

                const webpUrl = await uploadToCatbox(tempOut);
                if (!webpUrl) throw new Error("Upload sticker vẽ lỗi.");

                await api.sendCustomSticker({
                    staticImgUrl: webpUrl,
                    threadId,
                    threadType,
                    width: 512,
                    height: 512
                });
            } finally {
                if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
                if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
            }

        } catch (e) {
            log.error("Lỗi AI STK:", e.message);
            api.sendMessage(`⚠️ AI vẽ lỗi rồi: ${e.message}`, threadId, threadType);
        } finally {
            clearInterval(reactionInterval);
        }
    }
};
