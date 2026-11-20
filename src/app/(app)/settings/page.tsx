import { db } from "@/db";
import { githubConfig, whatsappConfig } from "@/lib/env";
import { eat } from "@/lib/format";
import { getLink } from "@/lib/whatsapp/link";
import { windowOpen } from "@/lib/whatsapp/notify";
import { WhatsAppControls } from "@/components/WhatsAppControls";
import { issueLinkCode, sendTestAlert, unlinkWhatsApp } from "./actions";

export default async function SettingsPage() {
  const wa = whatsappConfig();
  const gh = githubConfig();
  const link = await getLink(db());
  const linked = !!link?.ownerWaId;
  return (
    <>
      <h1>Integrations</h1>
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>WhatsApp</h2>
        {!wa ? (
          <p className="muted">Not configured. Add the WHATSAPP_* settings on the server (see SETUP.md).</p>
        ) : (
          <>
            <dl className="fields">
              <dt>Linked number</dt><dd>{linked ? `•••• ${link!.ownerWaId!.slice(-4)} (since ${eat(link!.linkedAt)})` : "None"}</dd>
              <dt>Last message from you</dt><dd>{eat(link?.lastInboundAt)}</dd>
              <dt>Free-form replies</dt>
              <dd>{windowOpen(link?.lastInboundAt) ? "Open (within 24 hours of your last message)" : `Closed: alerts use the "${wa.alertTemplate}" template`}</dd>
              <dt>Approvals from WhatsApp</dt><dd>Low risk only. Medium and High need your passkey here.</dd>
            </dl>
            <WhatsAppControls linked={linked} issue={issueLinkCode} test={sendTestAlert} />
            {linked && (
              <form action={unlinkWhatsApp} style={{ marginTop: 12 }}>
                <button className="secondary">Unlink this number</button>
              </form>
            )}
          </>
        )}
      </section>
      <section className="card">
        <h2>GitHub</h2>
        <p className="muted">
          {gh ? "Connected through a read-only GitHub App. Manage repositories on the Repositories page." : "Not configured. Create the read-only GitHub App (see SETUP.md)."}
        </p>
      </section>
    </>
  );
}
