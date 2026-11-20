"use client";
import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export function ApproveButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { challengeId, options } = await post(`/api/approvals/${id}/options`, {});
            const response = await startAuthentication({ optionsJSON: options });
            await post(`/api/approvals/${id}/approve`, { challengeId, response });
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Approval failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Approve with passkey
      </button>
      {error && <span className="error" role="alert"> {error}</span>}
    </span>
  );
}

export function RunButton({ id }: { id: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  return (
    <span>
      <button
        onClick={async () => {
          try {
            const r = await post(`/api/approvals/${id}/execute`, {});
            setMsg(r.ok ? "Done." : `Failed: ${r.error}`);
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Blocked.");
          }
          router.refresh();
        }}
      >
        Run approved action
      </button>
      {msg && <span className="muted"> {msg}</span>}
    </span>
  );
}
