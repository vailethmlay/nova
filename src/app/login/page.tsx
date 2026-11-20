import { redirect } from "next/navigation";
import { db } from "@/db";
import { passkeys } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { LoginClient } from "@/components/LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const keys = await db().select({ id: passkeys.id }).from(passkeys).limit(1);
  return (
    <div className="centre">
      <LoginClient setup={keys.length === 0} />
    </div>
  );
}
