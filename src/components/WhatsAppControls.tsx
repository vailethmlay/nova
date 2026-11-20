"use client";
import { useState, useTransition } from "react";
import type { LinkState } from "@/app/(app)/settings/actions";

const RESULT: Record<string, string> = {
  sent: "Sent.",
  sent_template: "Sent as a template (no message from you in the last 24 hours).",
  not_linked: "No number is linked yet.",
  not_configured: "WhatsApp isn't configured on the server.",
  failed: "Sending failed. Details are in the audit log.",
};

export function WhatsAppControls({
  linked,
  issue,
  test,
}: {
  linked: boolean;
  issue: () => Promise<LinkState>;
  test: () => Promise<LinkState>;
}) {
  const [state, setState] = useState<LinkState>({});
  const [pending, start] = useTransition();
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!linked && (
        <div>
          <button disabled={pending} onClick={() => start(async () => setState(await issue()))}>Get a link code</button>
          {state.code && (
            <p style={{ marginTop: 12 }}>
              From your phone, send <strong><code>link {state.code}</code></strong> to NOVA's WhatsApp number within 10 minutes.
              Then refresh this page.
            </p>
          )}
        </div>
      )}
      {linked && (
        <div>
          <button className="secondary" disabled={pending} onClick={() => start(async () => setState(await test()))}>Send a test alert</button>
          {state.result && <span className="muted"> {RESULT[state.result]}</span>}
        </div>
      )}
    </div>
  );
}
