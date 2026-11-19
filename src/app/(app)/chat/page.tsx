import { asc, desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { applications, chatMessages } from "@/db/schema";
import { ChatClient } from "@/components/ChatClient";

export default async function ChatPage() {
  const apps = await db().select({ id: applications.id, name: applications.name }).from(applications).orderBy(asc(applications.name));
  const recent = (
    await db().select().from(chatMessages).where(isNull(chatMessages.applicationId)).orderBy(desc(chatMessages.createdAt)).limit(20)
  ).reverse();
  return (
    <>
      <h1>Ask NOVA</h1>
      <p className="muted">NOVA can read and recommend. Anything that changes something goes to Approvals first.</p>
      <ChatClient apps={apps} initial={recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))} />
    </>
  );
}
