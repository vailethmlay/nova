"use client";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

export function LoginClient({ setup }: { setup: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const register = () =>
    run(async () => {
      const { challengeId, options } = await post("/api/auth/register/options", { setupToken: token });
      const response = await startRegistration({ optionsJSON: options });
      await post("/api/auth/register/verify", { challengeId, response, label: "First passkey" });
    });

  const login = () =>
    run(async () => {
      const { challengeId, options } = await post("/api/auth/login/options", {});
      const response = await startAuthentication({ optionsJSON: options });
      await post("/api/auth/login/verify", { challengeId, response });
    });

  return (
    <div className="card">
      <h1>NOVA</h1>
      {setup ? (
        <>
          <p className="muted">First-time setup. Enter the setup token from the server's environment, then create your passkey.</p>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); register(); }}>
            <label>
              Setup token
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
            </label>
            <button disabled={busy}>Create passkey</button>
          </form>
        </>
      ) : (
        <>
          <p className="muted">Sign in with your passkey.</p>
          <button onClick={login} disabled={busy}>Sign in</button>
        </>
      )}
      {error && <p className="error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
