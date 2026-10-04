import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { AgentContext } from "@/lib/agents/controls";
import { TYPESAFE_MODEL } from "./typesafe";

export const jevLock = (tx: Prisma.TransactionClient, org: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jev:${org}`}))`;
function key() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new ApiRequestError("JEV_SECRET_UNAVAILABLE", "The workspace secret is not configured securely.", 503);
  return createHash("sha256").update(`nautex-jev-key-v1:${secret}`).digest();
}
export function sealJevKey(org: string, value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(org));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64");
  return { iv: iv.toString("base64"), data, tag: cipher.getAuthTag().toString("base64") };
}
export function openJevKey(org: string, encrypted: unknown) {
  try {
    const v = encrypted as { iv: string; tag: string; data: string };
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(v.iv, "base64"));
    cipher.setAAD(Buffer.from(org)); cipher.setAuthTag(Buffer.from(v.tag, "base64"));
    return Buffer.concat([cipher.update(Buffer.from(v.data, "base64")), cipher.final()]).toString("utf8");
  } catch { throw new ApiRequestError("JEV_RECONNECT", "Save the Jev key again in Settings.", 409); }
}
export async function jevStatus(org: string, administrator = false) {
  const row = await prisma.jevSettings.findUnique({ where: { organizationId: org } });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const usedToday = await prisma.jevReview.count({ where: { organizationId: org, providerAttempted: true, createdAt: { gte: today } } });
  return { configured: Boolean(row?.secretCiphertext), enabled: row?.enabled ?? false, dailyLimit: row?.dailyLimit ?? 20,
    usedToday, model: TYPESAFE_MODEL, revision: row?.revision ?? 0,
    ...(administrator ? { recent: await prisma.jevReview.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, kind: true, status: true, createdAt: true, providerAttempted: true, inputTokens: true, outputTokens: true, durationMs: true } }) } : {}) };
}
export async function changeJevSettings(context: AgentContext, body: Record<string, unknown>) {
  if (!hasPermission(context, PERMISSIONS.ADMIN_USERS) || context.roles.includes("system-agent")) throw new ApiRequestError("PERMISSION_DENIED", "A human administrator must configure Jev.", 403);
  if (Object.keys(body).some(k => !["action", "apiKey", "enabled", "dailyLimit", "revision", "allowExternalProcessing"].includes(k))) throw new ApiRequestError("JEV_FIELDS_INVALID", "Unsupported settings field.", 400);
  if (!["save", "disconnect"].includes(String(body.action)) || !Number.isInteger(body.revision)) throw new ApiRequestError("JEV_SETTINGS_INVALID", "Refresh settings and choose a supported action.", 400);
  return prisma.$transaction(async tx => {
    await jevLock(tx, context.organizationId);
    const current = await tx.jevSettings.findUnique({ where: { organizationId: context.organizationId } });
    if ((current?.revision ?? 0) !== body.revision) throw new ApiRequestError("JEV_SETTINGS_CHANGED", "Settings changed in another session. Refresh before saving.", 409);
    const disconnect = body.action === "disconnect";
    if (!disconnect && (typeof body.enabled !== "boolean" || !Number.isInteger(body.dailyLimit) || Number(body.dailyLimit) < 1 || Number(body.dailyLimit) > 100)) throw new ApiRequestError("JEV_SETTINGS_INVALID", "Choose a daily limit from 1 to 100.", 400);
    const enabled = !disconnect && body.enabled === true;
    if (enabled && body.allowExternalProcessing !== true) throw new ApiRequestError("JEV_CONSENT_REQUIRED", "Confirm that selected record fields may be sent to TypeSafe.", 400);
    if (body.apiKey !== undefined && (typeof body.apiKey !== "string" || body.apiKey.length > 4096 || /\s/.test(body.apiKey))) throw new ApiRequestError("JEV_KEY_INVALID", "Enter a valid API key without spaces.", 400);
    const fresh = typeof body.apiKey === "string" && body.apiKey.length > 0 ? body.apiKey : null;
    if (fresh && fresh.length < 20) throw new ApiRequestError("JEV_KEY_INVALID", "The API key is too short.", 400);
    const secretCiphertext = disconnect ? Prisma.DbNull : fresh ? sealJevKey(context.organizationId, fresh) : current?.secretCiphertext ?? Prisma.DbNull;
    if (enabled && secretCiphertext === Prisma.DbNull) throw new ApiRequestError("JEV_KEY_REQUIRED", "Save a Jev API key before enabling reviews.", 400);
    const value = { enabled, secretCiphertext, dailyLimit: disconnect ? current?.dailyLimit ?? 20 : Number(body.dailyLimit), revision: (current?.revision ?? 0) + 1 };
    await tx.jevSettings.upsert({ where: { organizationId: context.organizationId }, create: { organizationId: context.organizationId, ...value }, update: value });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "jev_settings", entityId: context.organizationId, eventType: disconnect ? "jev_disconnected" : "jev_settings_changed", actorId: context.userId, sourceModule: "settings", metadata: { enabled, dailyLimit: value.dailyLimit, revision: value.revision, keyChanged: Boolean(fresh) || disconnect } } });
    return { saved: true };
  });
}
