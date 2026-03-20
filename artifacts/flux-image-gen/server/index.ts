import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();
const API_PORT = Number(process.env.API_SERVER_PORT || 5001);

app.use(cors());
app.use(express.json());

const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "dummy";

const ai = geminiBaseUrl
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl: geminiBaseUrl,
      },
    })
  : null;

app.post("/api/generate-prompt", async (req, res) => {
  const { idea, style } = req.body as {
    idea: string;
    style?: string;
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
    const styleHint = style ? `, artistic style: ${style}` : "";
    const systemPrompt = `You are an expert AI image prompt engineer for Flux image generation models.
Your task: Convert the user's idea into a detailed, professional English prompt for Flux Image AI.

Rules:
- Write ENTIRELY in English
- Describe in detail: lighting, colors, camera angle, artistic style, quality
- Add quality keywords: "highly detailed", "8K resolution", "masterpiece", "professional photography"
- Return ONLY the prompt text, no explanations or commentary
- Length: 50-150 words`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 512,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Create a Flux image prompt for this idea: "${idea}"${styleHint}`,
            },
          ],
        },
      ],
    });

    const prompt = response.text?.trim() || "";
    res.json({ prompt });
  } catch (err: unknown) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "Lỗi tạo prompt: " + (err as Error).message });
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

  const cfAccountId = "dc82ef97b674ecfcea390c10298fccb0";
  const cfApiToken = "cfut_byvmekovIfEF2eZRsmz4lmPagI1An1XGOVkufSbra47c0640";

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
        throw new Error(data.errors?.[0]?.message || "Không nhận được ảnh từ Cloudflare");
      }
    } else {
      const arrayBuffer = await cfResponse.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      res.json({ image: base64, mimeType: "image/png" });
    }
  } catch (err: unknown) {
    console.error("Cloudflare error:", err);
    res.status(500).json({ error: "Lỗi tạo ảnh: " + (err as Error).message });
  }
});

app.listen(API_PORT, () => {
  console.log(`API server running on port ${API_PORT}`);
});
