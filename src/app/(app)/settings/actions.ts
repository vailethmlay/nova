"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { metaSender } from "@/lib/whatsapp/api";
import { createLinkCode, unlink } from "@/lib/whatsapp/link";
import { notifyOwner, type NotifyResult } from "@/lib/whatsapp/notify";

export type LinkState = { code?: string; result?: NotifyResult };

export async function issueLinkCode(): Promise<LinkState> {
  await requireSession();
  return { code: await createLinkCode(db()) };
}

export async function sendTestAlert(): Promise<LinkState> {
  await requireSession();
  return { result: await notifyOwner(db(), metaSender, { text: "NOVA test alert: WhatsApp notifications are working." }) };
}

export async function unlinkWhatsApp() {
  await requireSession();
  await unlink(db());
  revalidatePath("/settings");
}
