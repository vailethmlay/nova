"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/(app)/apps/actions";

type App = Partial<Record<string, string | null>>;

export function AppForm({
  action,
  app = {},
  submitLabel,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  app?: App;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = (k: string) => app[k] ?? "";
  return (
    <form className="stack" action={formAction}>
      <div className="row2">
        <label>Name<input name="name" defaultValue={v("name")} required maxLength={80} /></label>
        <label>
          Status
          <select name="status" defaultValue={v("status") || "active"}>
            {["planning", "active", "maintenance", "paused", "retired"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <label>Description<textarea name="description" defaultValue={v("description")} /></label>
      <div className="row2">
        <label>Repository URL<input name="repositoryUrl" type="url" defaultValue={v("repositoryUrl")} /></label>
        <label>Production URL<input name="productionUrl" type="url" defaultValue={v("productionUrl")} /></label>
      </div>
      <div className="row2">
        <label>Technology stack<input name="techStack" defaultValue={v("techStack")} /></label>
        <label>Deployment provider<input name="deploymentProvider" defaultValue={v("deploymentProvider")} /></label>
      </div>
      <div className="row2">
        <label>Development environment<input name="devEnvironment" defaultValue={v("devEnvironment")} /></label>
        <label>Latest version<input name="latestVersion" defaultValue={v("latestVersion")} /></label>
      </div>
      <label>Known issues<textarea name="knownIssues" defaultValue={v("knownIssues")} /></label>
      <label>Pending tasks<textarea name="pendingTasks" defaultValue={v("pendingTasks")} /></label>
      <label>Future roadmap<textarea name="roadmap" defaultValue={v("roadmap")} /></label>
      <label>
        What NOVA should remember about this app (decisions, rejected ideas, history)
        <textarea name="contextNotes" defaultValue={v("contextNotes")} style={{ minHeight: 120 }} />
      </label>
      <div><button disabled={pending}>{pending ? "Saving…" : submitLabel}</button></div>
      {state.error && <p className="error" role="alert">{state.error}</p>}
    </form>
  );
}
