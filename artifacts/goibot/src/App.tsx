import { useState, useRef, useEffect } from "react";

const API_BASE = "https://mizai.linhrwn.workers.dev/";
const API_KEY = "123456";
const DEFAULT_ROLE = "Bạn là trợ lý AI thông minh, trả lời bằng tiếng Việt";

type Message = {
  role: "user" | "bot";
  content: string;
};

function BotIcon() {
  return (
    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
      G
    </div>
  );
}

function UserIcon() {
  return (
    <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-slate-700 text-sm font-bold shrink-0">
      U
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 items-end">
      <BotIcon />
      <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 items-end ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {isUser ? <UserIcon /> : <BotIcon />}
      <div
        className={`max-w-[75%] px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function RoleModal({
  role,
  onSave,
  onClose,
}: {
  role: string;
  onSave: (r: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(role);
  const presets = [
    "Bạn là trợ lý AI thông minh, trả lời bằng tiếng Việt",
    "Bạn là gái cute nói chuyện dễ thương",
    "Bạn là chuyên gia lập trình, giải thích rõ ràng",
    "Bạn là giáo viên tiếng Anh, giúp học sinh học tập",
    "Bạn là đầu bếp chuyên nghiệp, chia sẻ công thức nấu ăn",
  ];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-base">Tuỳ chỉnh nhân cách</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Role / Nhân cách của bot</label>
          <textarea
            value={val}
            onChange={(e) => setVal(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">Gợi ý nhanh</p>
          <div className="flex flex-col gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setVal(p)}
                className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                  val === p
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-slate-50"
          >
            Huỷ
          </button>
          <button
            onClick={() => { onSave(val); onClose(); }}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "bot", content: "Xin chào! Tôi là GoiBot. Bạn cần tôi giúp gì hôm nay?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setInput("");
    setLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const params = new URLSearchParams({ key: API_KEY, prompt, role });
      const res = await fetch(`${API_BASE}?${params.toString()}`);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const reply = data.response || "Không có phản hồi.";
      setMessages((prev) => [...prev, { role: "bot", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", content: "Có lỗi xảy ra. Vui lòng thử lại." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const clearChat = () => {
    setMessages([{ role: "bot", content: "Xin chào! Tôi là GoiBot. Bạn cần tôi giúp gì hôm nay?" }]);
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {showRoleModal && (
        <RoleModal
          role={role}
          onSave={(r) => {
            setRole(r);
            setMessages([{ role: "bot", content: "Nhân cách đã được cập nhật! Tôi có thể giúp gì cho bạn?" }]);
          }}
          onClose={() => setShowRoleModal(false)}
        />
      )}

      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 shadow-sm">
        <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-base shrink-0">
          G
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 leading-tight">GoiBot</p>
          <p className="text-xs text-slate-400 truncate">{role}</p>
        </div>
        <button
          onClick={() => setShowRoleModal(true)}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
        >
          ⚙ Role
        </button>
        <button
          onClick={clearChat}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
        >
          🗑 Xoá chat
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <div className="bg-white border-t border-slate-200 px-4 py-3">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Nhập tin nhắn... (Enter để gửi)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition overflow-hidden"
            style={{ minHeight: "42px", maxHeight: "160px" }}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors h-[42px]"
          >
            Gửi
          </button>
        </div>
      </div>
    </div>
  );
}
