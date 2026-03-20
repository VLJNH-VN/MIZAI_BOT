import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();
const API_PORT = 5001;

app.use(cors());
app.use(express.json());

const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "dummy";

let ai: GoogleGenAI | null = null;
if (geminiBaseUrl) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: { baseUrl: geminiBaseUrl },
  });
}

app.post("/api/generate-prompt", async (req, res) => {
  const { idea, style, language } = req.body as {
    idea: string;
    style?: string;
    language?: string;
  };

  if (!idea) {
    res.status(400).json({ error: "Thiếu ý tưởng (idea)" });
    return;
  }

  if (!ai) {
    res.status(500).json({ error: "Gemini AI chưa được cấu hình" });
    return;
  }

  try {
    const styleHint = style ? `, phong cách: ${style}` : "";
    const systemPrompt = `Bạn là chuyên gia tạo prompt ảnh AI chuyên nghiệp cho mô hình Flux. 
Nhiệm vụ: Chuyển ý tưởng người dùng thành prompt tiếng Anh chi tiết, chuyên nghiệp cho Flux Image AI.

Quy tắc:
- Viết HOÀN TOÀN bằng tiếng Anh
- Mô tả chi tiết: ánh sáng, màu sắc, góc chụp, phong cách nghệ thuật, chất lượng
- Thêm các từ khóa chất lượng: "highly detailed", "8K", "photorealistic", "masterpiece"
- Chỉ trả về prompt, không có giải thích thêm
- Độ dài 50-150 từ`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Tạo prompt Flux cho ý tưởng: "${idea}"${styleHint}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 500,
      },
    });

    const prompt = response.text?.trim() || "";
    res.json({ prompt });
  } catch (err: unknown) {
    console.error("Gemini error:", err);
    res
      .status(500)
      .json({ error: "Lỗi tạo prompt: " + (err as Error).message });
  }
});

app.post("/api/generate-image", async (req, res) => {
  const { prompt, width, height, steps } = req.body as {
    prompt: string;
    width?: number;
    height?: number;
    steps?: number;
  };

  if (!prompt) {
    res.status(400).json({ error: "Thiếu prompt" });
    return;
  }

  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!cfAccountId || !cfApiToken) {
    res.status(503).json({
      error:
        "Cloudflare chưa được cấu hình. Vui lòng thêm CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN.",
    });
    return;
  }

  try {
    const imgWidth = width || 1024;
    const imgHeight = height || 1024;
    const numSteps = steps || 4;

    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          num_steps: numSteps,
          width: imgWidth,
          height: imgHeight,
        }),
      }
    );

    if (!cfResponse.ok) {
      const errorText = await cfResponse.text();
      throw new Error(`Cloudflare API lỗi ${cfResponse.status}: ${errorText}`);
    }

    const contentType = cfResponse.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = (await cfResponse.json()) as {
        result?: { image?: string };
        errors?: Array<{ message: string }>;
      };
      if (data.result?.image) {
        res.json({ image: data.result.image, mimeType: "image/png" });
      } else {
        throw new Error(
          data.errors?.[0]?.message || "Không nhận được ảnh từ Cloudflare"
        );
      }
    } else {
      const arrayBuffer = await cfResponse.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      res.json({ image: base64, mimeType: "image/png" });
    }
  } catch (err: unknown) {
    console.error("Cloudflare error:", err);
    res
      .status(500)
      .json({ error: "Lỗi tạo ảnh: " + (err as Error).message });
  }
});

app.listen(API_PORT, () => {
  console.log(`API server running on port ${API_PORT}`);
});
