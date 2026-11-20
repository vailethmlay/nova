# Connecting GitHub and WhatsApp (Phase 2)

Both services send webhooks, so NOVA must be reachable on a public **HTTPS** address first, for example `https://nova.yourdomain`. Set `NOVA_ORIGIN` and `NOVA_RP_ID` to match it.

Put every value below in the server's `.env`. Never paste them into chat, an issue or the repo.

---

## 1. GitHub App (read-only)

1. Go to GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Fill in:
   - **Name:** e.g. `nova-vailethmlay`. The URL slug becomes `GITHUB_APP_SLUG`.
   - **Homepage URL:** your `NOVA_ORIGIN`.
   - **Webhook URL:** `NOVA_ORIGIN/api/webhooks/github`.
   - **Webhook secret:** generate one with `openssl rand -hex 32` and use it as `GITHUB_WEBHOOK_SECRET`.
3. **Repository permissions.** Set these five to **Read-only**, and leave everything else at *No access*:
   - Actions
   - Contents
   - Issues
   - Metadata
   - Pull requests
4. **Subscribe to events:** Pull request, Workflow run, Issues, Release.
5. **Where can this app be installed:** *Only on this account*.
6. Create the app. Note the **App ID** and use it as `GITHUB_APP_ID`.
7. **Generate a private key**, which downloads a `.pem` file. Convert it to one line:
   `base64 -w0 your-app.private-key.pem` → `GITHUB_APP_PRIVATE_KEY_BASE64`. (On macOS, use `base64 -i file.pem`.)
   Then delete the downloaded file.
8. **Install App** → choose *Only select repositories* → pick the repos NOVA should watch, e.g. myAIDA.

NOVA syncs every 15 minutes and on every webhook. In the dashboard, open **Repositories** and link each repo to its application.

> The app is read-only by design. Write access (for example, merging an approved PR) comes in Phase 4, through a separate credential that only the executor holds.

---

## 2. WhatsApp Cloud API (Meta)

You need a **phone number that isn't already registered on WhatsApp**. It becomes NOVA's number; your personal WhatsApp stays as it is.

1. **Meta Business portfolio:** create one at business.facebook.com if you don't have one.
2. **Meta app:** at developers.facebook.com → *Create app* → type **Business** → add the **WhatsApp** product.
3. **Phone number:** WhatsApp → *API Setup* → *Add phone number*, then verify it by SMS or a voice call.
   - Copy the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
4. **Permanent access token:** Business settings → *System users* → add a system user with the Admin role.
   - Assign it the app and the WhatsApp account.
   - Generate a token with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
   - Use it as `WHATSAPP_ACCESS_TOKEN`. The temporary 24-hour token on the API Setup page won't do for this.
5. **App secret:** App settings → *Basic* → *App secret* → `WHATSAPP_APP_SECRET`.
6. **Webhook:** WhatsApp → *Configuration* → *Webhook*:
   - **Callback URL:** `NOVA_ORIGIN/api/webhooks/whatsapp`.
   - **Verify token:** generate one with `openssl rand -hex 16` and use the same value as `WHATSAPP_VERIFY_TOKEN`.
   - Click *Verify and save*, then **subscribe to the `messages` field**.
7. **Alert template.** WhatsApp only lets NOVA send free-form messages within 24 hours of your last message to it. Outside that window, it uses this template:
   - WhatsApp Manager → *Message templates* → *Create*.
   - **Category:** Utility. **Name:** `nova_alert` (→ `WHATSAPP_ALERT_TEMPLATE`). **Language:** English (`en`).
   - **Body:** `NOVA alert: {{1}} Details: {{2}}`
   - Submit it. Meta reviews templates, usually within minutes to a day.
8. Restart NOVA. Then, in the dashboard, go to **Integrations → Get a link code**. From your own phone, send `link 123456` (with your code) to NOVA's number within 10 minutes.

After linking:

- Send `status` for an overview, or `approvals` to see what's waiting. Anything else you send is a question for NOVA.
- **Low-risk** approvals arrive with Approve and Reject buttons. **Medium and High** risk can only be approved on the dashboard with your passkey.
- Alerts: failed builds on a repo's default branch, new pull requests, new releases, and approval requests.

**Cost:** Meta charges per delivered template message. Since 1 October 2026, replies inside the 24-hour window are also charged after the first 1,000 a month per number. At NOVA's volume, the cost should be small.

---

## 3. Run the worker

The worker is a separate process that does the scheduled GitHub sync:

```bash
npm run worker
```

Run it under your process manager (systemd, pm2, or your host's worker service) next to `npm start`.
