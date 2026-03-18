const axios = require("axios");

module.exports = {
  config: {
    name: "thoitiet",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "MiZai",
    description: "Tra cứu thời tiết theo địa điểm (dùng wttr.in)",
    commandCategory: "Tra Cứu",
    usages: "thoitiet [tên thành phố]",
    cooldowns: 10
  },

  run: async ({ args, send }) => {
    const location = args.join(" ").trim() || "Ho Chi Minh City";

    try {
      const res = await axios.get(
        `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
        { timeout: 10000, headers: { "User-Agent": "MiZai-Bot/1.0" } }
      );

      const data = res.data;
      const current = data?.current_condition?.[0];
      const nearest = data?.nearest_area?.[0];

      if (!current) {
        return send(`❌ Không tìm thấy thông tin thời tiết cho: "${location}"`);
      }

      const cityName = nearest?.areaName?.[0]?.value || location;
      const country = nearest?.country?.[0]?.value || "";
      const tempC = current.temp_C;
      const feelsLike = current.FeelsLikeC;
      const humidity = current.humidity;
      const windSpeed = current.windspeedKmph;
      const desc = current.lang_vi?.[0]?.value || current.weatherDesc?.[0]?.value || "Không rõ";
      const uvIndex = current.uvIndex;
      const visibility = current.visibility;

      const weather = data?.weather?.[0];
      const maxTemp = weather?.maxtempC;
      const minTemp = weather?.mintempC;

      const uvLevel = (uv) => {
        if (uv <= 2) return "Thấp 🟢";
        if (uv <= 5) return "Trung bình 🟡";
        if (uv <= 7) return "Cao 🟠";
        if (uv <= 10) return "Rất cao 🔴";
        return "Cực cao ☢️";
      };

      return send(
        `🌤️ Thời Tiết — ${cityName}${country ? ", " + country : ""}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🌡️ Nhiệt độ: ${tempC}°C (cảm giác ${feelsLike}°C)\n` +
        `📊 Cao/Thấp: ${maxTemp}°C / ${minTemp}°C\n` +
        `☁️ Trạng thái: ${desc}\n` +
        `💧 Độ ẩm: ${humidity}%\n` +
        `💨 Gió: ${windSpeed} km/h\n` +
        `👁️ Tầm nhìn: ${visibility} km\n` +
        `☀️ Chỉ số UV: ${uvIndex} (${uvLevel(Number(uvIndex))})\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📍 Nguồn: wttr.in`
      );

    } catch (err) {
      return send(
        `❌ Không thể lấy thông tin thời tiết cho: "${location}"\n` +
        `💡 Thử lại với tên thành phố tiếng Anh, ví dụ: .thoitiet Hanoi`
      );
    }
  }
};
