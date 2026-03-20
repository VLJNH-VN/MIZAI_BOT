import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { toast } from "sonner";
import { Wand2, Image, Download, RefreshCw, Sparkles, ChevronDown, Loader2, Copy, Check } from "lucide-react";

const queryClient = new QueryClient();

const STYLES = [
  { value: "", label: "Tự động" },
  { value: "photorealistic", label: "Ảnh thực tế" },
  { value: "digital art", label: "Nghệ thuật số" },
  { value: "anime", label: "Anime" },
  { value: "oil painting", label: "Tranh sơn dầu" },
  { value: "watercolor", label: "Màu nước" },
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "fantasy art", label: "Fantasy" },
  { value: "minimalist", label: "Tối giản" },
  { value: "3D render", label: "3D Render" },
  { value: "sketch", label: "Phác thảo" },
  { value: "cinematic", label: "Điện ảnh" },
];

const SIZES = [
  { label: "Vuông 1:1", width: 1024, height: 1024 },
  { label: "Ngang 16:9", width: 1360, height: 768 },
  { label: "Dọc 9:16", width: 768, height: 1360 },
  { label: "Ngang 4:3", width: 1024, height: 768 },
  { label: "Dọc 3:4", width: 768, height: 1024 },
];

function ImageGenerator() {
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState("");
  const [selectedSize, setSelectedSize] = useState(SIZES[0]);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [editedPrompt, setEditedPrompt] = useState("");
  const [imageData, setImageData] = useState<{ image: string; mimeType: string } | null>(null);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [steps, setSteps] = useState(4);

  const handleGeneratePrompt = useCallback(async () => {
    if (!idea.trim()) {
      toast.error("Vui lòng nhập ý tưởng của bạn!");
      return;
    }
    setIsGeneratingPrompt(true);
    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, style }),
      });
      const data = await res.json() as { prompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Lỗi không xác định");
      setGeneratedPrompt(data.prompt || "");
      setEditedPrompt(data.prompt || "");
      toast.success("Đã tạo prompt thành công!");
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setIsGeneratingPrompt(false);
    }
  }, [idea, style]);

  const handleGenerateImage = useCallback(async () => {
    const prompt = editedPrompt || generatedPrompt;
    if (!prompt.trim()) {
      toast.error("Vui lòng tạo hoặc nhập prompt trước!");
      return;
    }
    setIsGeneratingImage(true);
    setImageData(null);
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          width: selectedSize.width,
          height: selectedSize.height,
          steps,
        }),
      });
      const data = await res.json() as { image?: string; mimeType?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Lỗi không xác định");
      setImageData({ image: data.image!, mimeType: data.mimeType || "image/png" });
      toast.success("Ảnh đã được tạo thành công!");
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setIsGeneratingImage(false);
    }
  }, [editedPrompt, generatedPrompt, selectedSize, steps]);

  const handleDownload = useCallback(() => {
    if (!imageData) return;
    const link = document.createElement("a");
    link.href = `data:${imageData.mimeType};base64,${imageData.image}`;
    link.download = `flux-image-${Date.now()}.png`;
    link.click();
  }, [imageData]);

  const handleCopyPrompt = useCallback(() => {
    const prompt = editedPrompt || generatedPrompt;
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [editedPrompt, generatedPrompt]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-none">Flux AI Image Generator</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Powered by Gemini + Cloudflare Workers AI</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel - Controls */}
          <div className="space-y-5">
            {/* Idea Input */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Wand2 className="w-4 h-4 text-primary" />
                Ý tưởng của bạn
              </label>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Mô tả bức ảnh bạn muốn tạo... VD: Một con rồng bay trên thành phố tương lai lúc hoàng hôn"
                className="w-full bg-background border border-input rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                rows={4}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleGeneratePrompt();
                }}
              />
              <p className="text-xs text-muted-foreground">Nhấn Ctrl+Enter để tạo prompt nhanh</p>
            </div>

            {/* Style Selector */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <label className="text-sm font-semibold text-foreground">Phong cách nghệ thuật</label>
              <div className="grid grid-cols-3 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setStyle(s.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      style === s.value
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Prompt Button */}
            <button
              onClick={handleGeneratePrompt}
              disabled={isGeneratingPrompt || !idea.trim()}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isGeneratingPrompt ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gemini đang tạo prompt...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Tạo Prompt với Gemini AI
                </>
              )}
            </button>

            {/* Generated Prompt */}
            {(generatedPrompt || editedPrompt) && (
              <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-foreground">Prompt đã tạo (có thể chỉnh sửa)</label>
                  <button
                    onClick={handleCopyPrompt}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Đã sao chép" : "Sao chép"}
                  </button>
                </div>
                <textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="w-full bg-background border border-input rounded-lg px-4 py-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono leading-relaxed"
                  rows={5}
                />
              </div>
            )}

            {/* Image Settings */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <label className="text-sm font-semibold text-foreground">Cài đặt ảnh</label>

              {/* Size */}
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Kích thước</span>
                <div className="grid grid-cols-2 gap-2">
                  {SIZES.map((sz) => (
                    <button
                      key={sz.label}
                      onClick={() => setSelectedSize(sz)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left ${
                        selectedSize.label === sz.label
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-background border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <div>{sz.label}</div>
                      <div className="text-[10px] opacity-60">{sz.width}×{sz.height}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Số bước suy luận</span>
                  <span className="text-xs font-mono text-primary">{steps}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Nhanh (1)</span>
                  <span>Chất lượng (8)</span>
                </div>
              </div>
            </div>

            {/* Generate Image Button */}
            <button
              onClick={handleGenerateImage}
              disabled={isGeneratingImage || (!generatedPrompt && !editedPrompt)}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              {isGeneratingImage ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Flux đang tạo ảnh...
                </>
              ) : (
                <>
                  <Image className="w-4 h-4" />
                  Tạo Ảnh với Flux AI
                </>
              )}
            </button>
          </div>

          {/* Right Panel - Image Preview */}
          <div className="space-y-4">
            <div
              className="bg-card border border-border rounded-xl overflow-hidden"
              style={{
                aspectRatio: `${selectedSize.width}/${selectedSize.height}`,
                minHeight: 300,
              }}
            >
              {isGeneratingImage ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 shimmer min-h-[300px]">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">Đang tạo ảnh...</p>
                      <p className="text-xs text-muted-foreground mt-1">Flux đang xử lý, vui lòng chờ</p>
                    </div>
                  </div>
                </div>
              ) : imageData ? (
                <img
                  src={`data:${imageData.mimeType};base64,${imageData.image}`}
                  alt="Generated image"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 min-h-[300px]">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Image className="w-8 h-8 text-primary/50" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground/60">Ảnh sẽ hiển thị ở đây</p>
                    <p className="text-xs text-muted-foreground mt-1">Nhập ý tưởng và nhấn tạo ảnh</p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            {imageData && (
              <div className="flex gap-3">
                <button
                  onClick={handleDownload}
                  className="flex-1 py-2.5 rounded-xl bg-card border border-border text-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent transition-all"
                >
                  <Download className="w-4 h-4" />
                  Tải ảnh
                </button>
                <button
                  onClick={handleGenerateImage}
                  className="flex-1 py-2.5 rounded-xl bg-card border border-border text-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent transition-all"
                >
                  <RefreshCw className="w-4 h-4" />
                  Tạo lại
                </button>
              </div>
            )}

            {/* Tips */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-foreground/80">Hướng dẫn sử dụng</p>
              <ol className="space-y-1.5 text-xs text-muted-foreground list-none">
                {[
                  "Nhập ý tưởng bằng tiếng Việt hoặc tiếng Anh",
                  "Chọn phong cách nghệ thuật phù hợp",
                  "Nhấn 'Tạo Prompt' để Gemini AI tối ưu hóa",
                  "Chỉnh sửa prompt nếu muốn",
                  "Nhấn 'Tạo Ảnh' để Flux AI sinh ảnh",
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {tip}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ImageGenerator />
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
