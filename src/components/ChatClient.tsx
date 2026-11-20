"use client";
import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type App = { id: string; name: string };

export function ChatClient({ apps, initial }: { apps: App[]; initial: Msg[] }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [appId, setAppId] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setMessages((m) => [...m, { role: "user", content: message }]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, applicationId: appId || null }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? data.error ?? "No answer." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="chat" aria-live="polite">
        {messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
        {busy && <div className="msg assistant muted">Thinking…</div>}
      </div>
      <form className="stack" onSubmit={send}>
        <label>
          About
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">All applications</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nova, check what's happening with myAIDA."
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
        />
        <div><button disabled={busy}>Send</button></div>
      </form>
    </>
  );
}
