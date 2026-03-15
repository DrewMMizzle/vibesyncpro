import { db } from "../../db";
import { users } from "@shared/schema";
import { isEncrypted, encryptToken } from "./crypto";

export async function migrateTokenEncryption(): Promise<void> {
  if (!process.env.ENCRYPTION_KEY) return;

  const allUsers = await db.select({ id: users.id, access_token: users.access_token }).from(users);
  let migrated = 0;
  for (const u of allUsers) {
    if (u.access_token && !isEncrypted(u.access_token)) {
      const encrypted = encryptToken(u.access_token);
      await db.update(users).set({ access_token: encrypted }).where(
        (await import("drizzle-orm")).eq(users.id, u.id)
      );
      migrated++;
    }
  }
  if (migrated > 0) {
    console.log(`Encrypted ${migrated} plaintext access token${migrated === 1 ? "" : "s"}.`);
  }
}
