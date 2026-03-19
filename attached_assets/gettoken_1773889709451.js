const axios = require("axios");
const fs = require("fs");

module.exports.config = {
    name: "gettoken",
    version: "1.0.1",
    hasPermssion: 0,
    credits: "Dũngkon||Vtuan",
    description: "Lấy token EAAD6V7 từ cookie",
    commandCategory: "Tiện ích",
    usages: "cookie",
    cooldowns: 5,
    images: [],
};

module.exports.handleReply = async ({ api, event, handleReply, Users }) => {
    const { threadID, messageID, senderID, body } = event;
    if (handleReply.content.id != senderID) return;

    const input = body.trim();

    const sendC = (msg, step, content) => api.sendMessage(msg, threadID, (err, info) => {
        global.client.handleReply.splice(global.client.handleReply.indexOf(handleReply), 1);
        api.unsendMessage(handleReply.messageID);
        global.client.handleReply.push({
            step: step,
            name: module.exports.config.name,
            messageID: info.messageID,
            content: content
        });
    }, messageID);

    const send = async (msg) => api.sendMessage(msg, threadID, messageID);

    let content = handleReply.content;
    switch (handleReply.step) {
        case 1:
            function isValidURL(string) {
                try {
                    new URL(string);
                    return true;
                } catch (_) {
                    return false;
                }
            }
            let formattedData = [];

            if (isValidURL(input)) {
                try {
                    const response = await axios.get(input);
                    const data = response.data;

                    if (typeof data === 'string') {
                        formattedData = data.split('\n').map(line => line.trim()).filter(line => line);
                    } else {
                        return send("Dữ liệu từ URL không hợp lệ. Vui lòng thử lại.");
                    }
                } catch (error) {
                    return send("Không thể truy cập URL. Vui lòng thử lại.");
                }
            } else {
                formattedData = input.split('\n').map(line => line.trim()).filter(line => line);
            }

            content.cookie = formattedData;
            sendC(
                `Reply tin nhắn này để nhập loại token bạn muốn lấy!
1. EAAAAU: 350685531728
2. EAAD: 256002347743983
3. EAAAAAY: 6628568379
4. EAADYP: 237759909591655
5. EAAD6V7: 275254692598279
6. EAAC2SPKT: 202805033077166
7. EAAGOfO: 200424423651082
8. EAAVB: 438142079694454
9. EAAC4: 1479723375646806
10. EAACW5F: 165907476854626
11. EAAB: 121876164619130
12. EAAQ: 1174099472704185
13. EAAGNO4: 436761779744620
14. EAAH: 522404077880990
15. EAAC: 184182168294603
16. EAAClA: 173847642670370
17. EAATK: 1348564698517390
18. EAAI7: 628551730674460`,
                2,
                content
            );
            break;
        case 2:
            let b;
            switch (input) {
                case "1":
                    b = "350685531728";
                    break;
                case "2":
                    b = "256002347743983";
                    break;
                case "3":
                    b = "6628568379";
                    break;
                case "4":
                    b = "237759909591655";
                    break;
                case "5":
                    b = "275254692598279";
                    break;
                case "6":
                    b = "202805033077166";
                    break;
                case "7":
                    b = "200424423651082";
                    break;
                case "8":
                    b = "438142079694454";
                    break;
                case "9":
                    b = "1479723375646806";
                    break;
                case "10":
                    b = "165907476854626";
                    break;
                case "11":
                    b = "121876164619130";
                    break;
                case "12":
                    b = "1174099472704185";
                    break;
                case "13":
                    b = "436761779744620";
                    break;
                case "14":
                    b = "522404077880990";
                    break;
                case "15":
                    b = "184182168294603";
                    break;
                case "16":
                    b = "173847642670370";
                    break;
                case "17":
                    b = "1348564698517390";
                    break;
                case "18":
                    b = "628551730674460";
                    break;
                default:
                    return send("Lựa chọn không hợp lệ, vui lòng thử lại.");
            }

            api.setMessageReaction("⌛", event.messageID, () => { }, true);

            global.client.handleReply.splice(global.client.handleReply.indexOf(handleReply), 1);
            api.unsendMessage(handleReply.messageID);

            let tokens = [];
            let errorOccurred = false;

            for (let cc of content.cookie) {
                try {
                    const response = await axios.get(`https://apibot.sumiproject.io.vn/facebook/gettokentocookie?id=${b}&cookie=${cc}&apikey=DUNGKON_2002`);
                    const tokenData = response.data.access_token;
                    if (tokenData) {
                        tokens.push(tokenData);
                    }
                } catch (error) {
                    errorOccurred = true;
                }
            }

            if (tokens.length > 0) {
                try {
                    const tokenText = tokens.join('\n\n');
                    api.sendMessage(`${tokenText}`, threadID, messageID);
                } catch (error) {
                    api.sendMessage("Đã có lỗi xảy ra khi tải lên RunMocky, vui lòng thử lại sau!", threadID, messageID);
                }
            } else {
                api.sendMessage("Có lỗi xảy ra", threadID, messageID);
            }
            break;
        default:
            break;
    }
}

module.exports.run = ({ api, event }) => {
    const { threadID, messageID, senderID } = event;
    return api.sendMessage("Vui lòng reply tin nhắn này và nhập cookie hoặc URL chứa cookie", threadID, (err, info) => {
        global.client.handleReply.push({
            step: 1,
            name: module.exports.config.name,
            messageID: info.messageID,
            content: {
                id: senderID,
                cookie: ""
            }
        });
    }, messageID);
}
