import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import type { AgentContext } from "@/lib/agents/controls";
import { hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

const SCOPES = "https://graph.microsoft.com/Mail.ReadBasic https://graph.microsoft.com/User.Read offline_access";
type Flow = { kind: "device"; flowId: string; deviceCode: string; expiresAt: number; nextPollAt: number; interval: number };
type Tokens = { kind: "tokens"; accessToken: string; refreshToken: string; expiresAt: number; account: string };
function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new ApiRequestError("SECRET_UNAVAILABLE", "Secure local credential storage is unavailable.", 409);
  return createHash("sha256").update(`nautex-mailbox-v1:${secret}`).digest();
}
export function sealMailbox(organizationId: string, value: Flow | Tokens) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), content: content.toString("base64") });
}
function openMailbox(organizationId: string, encrypted: string): Flow | Tokens {
  try { const value = JSON.parse(encrypted), decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64")); decipher.setAAD(Buffer.from(organizationId)); decipher.setAuthTag(Buffer.from(value.tag, "base64")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.content, "base64")), decipher.final()]).toString()); }
  catch { throw new ApiRequestError("MAILBOX_RECONNECT", "Mailbox credentials could not be opened. Reconnect the account.", 409); }
}
function administrator(context: AgentContext) {
  if (!hasPermission(context, PERMISSIONS.ADMIN_USERS) || context.roles.includes("system-agent")) throw new ApiRequestError("PERMISSION_DENIED", "A human administrator must connect a mailbox.", 403);
}
const tenantPattern = /^(organizations|consumers|common|[a-f0-9-]{36})$/i;
const clientPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function oauth(tenant: string, endpoint: string, body: Record<string, string>) {
  if (!tenantPattern.test(tenant)) throw new ApiRequestError("TENANT_INVALID", "Use a tenant GUID or organizations, consumers or common.", 400);
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000), redirect: "error" });
  return { status: response.status, ok: response.ok, data: await response.json() as Record<string, unknown> };
}
async function graph(url: string, token: string, signal?: AbortSignal) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://graph.microsoft.com" || !parsed.pathname.startsWith("/v1.0/me") || parsed.username || parsed.password) throw new ApiRequestError("MAILBOX_LINK_INVALID", "Mailbox pagination returned an unexpected address.", 502);
  const response = await fetch(parsed, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiRequestError("MAILBOX_PROVIDER_FAILED", response.status === 401 || response.status === 403 ? "Mailbox access was rejected. Reconnect and check read permissions." : "Mailbox service unavailable or rate-limited. Retry later.", 502);
  return response.json();
}
export async function mailboxStatus(organizationId: string) {
  const row = await prisma.mailboxConnection.findUnique({ where: { organizationId } });
  let account = "", connected = false;
  if (row?.secretCiphertext) { try { const secret = openMailbox(organizationId, row.secretCiphertext); connected = secret.kind === "tokens"; if (connected) account = (secret as Tokens).account; } catch { /* UI offers reconnect; credentials never returned. */ } }
  return { provider: "microsoft365", configured: Boolean(row), connected, enabled: row?.enabled ?? false, clientId: row?.clientId ?? "", tenantId: row?.tenantId ?? "organizations", account, revision: row?.revision ?? 0 };
}
export async function beginMailboxConnection(context: AgentContext, body: Record<string, unknown>) {
  administrator(context);
  const clientId = String(body.clientId ?? ""), tenantId = String(body.tenantId ?? "organizations");
  if (!clientPattern.test(clientId) || !tenantPattern.test(tenantId)) throw new ApiRequestError("MAILBOX_CONFIG_INVALID", "Enter your Microsoft Entra public-client application ID and tenant GUID (or organizations).", 400);
  const response = await oauth(tenantId, "devicecode", { client_id: clientId, scope: SCOPES });
  const data = response.data;
  if (!response.ok || typeof data.device_code !== "string" || typeof data.user_code !== "string" || typeof data.verification_uri !== "string" || !Number.isFinite(Number(data.expires_in))) throw new ApiRequestError("MAILBOX_SIGNIN_FAILED", "Microsoft sign-in could not start. Check the public-client registration and tenant policy.", 502);
  const uri = new URL(data.verification_uri);
  if (uri.protocol !== "https:" || !["microsoft.com", "www.microsoft.com", "login.microsoftonline.com"].includes(uri.hostname)) throw new ApiRequestError("MAILBOX_SIGNIN_FAILED", "Microsoft returned an unexpected sign-in address.", 502);
  const flowId = randomUUID(), interval = Math.max(5, Math.min(60, Number(data.interval) || 5));
  const secretCiphertext = sealMailbox(context.organizationId, { kind: "device", flowId, deviceCode: data.device_code, interval, nextPollAt: Date.now() + interval * 1000, expiresAt: Date.now() + Math.min(900, Number(data.expires_in)) * 1000 });
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mailbox:${context.organizationId}`}))`;
    await tx.mailboxConnection.upsert({ where: { organizationId: context.organizationId }, create: { organizationId: context.organizationId, clientId, tenantId, createdBy: context.userId, secretCiphertext }, update: { clientId, tenantId, createdBy: context.userId, secretCiphertext, enabled: false, revision: { increment: 1 } } });
  });
  return { flowId, userCode: data.user_code, verificationUri: uri.href, interval, expiresIn: Math.min(900, Number(data.expires_in)) };
}
export async function pollMailboxConnection(context: AgentContext, flowId: string) {
  administrator(context);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mailbox:${context.organizationId}`}))`;
    const row = await tx.mailboxConnection.findUnique({ where: { organizationId: context.organizationId } });
    if (!row?.secretCiphertext || row.createdBy !== context.userId) throw new ApiRequestError("MAILBOX_FLOW_MISSING", "Start sign-in from this administrator account.", 409);
    const secret = openMailbox(context.organizationId, row.secretCiphertext);
    if (secret.kind !== "device" || secret.flowId !== flowId || secret.expiresAt < Date.now()) throw new ApiRequestError("MAILBOX_FLOW_EXPIRED", "Sign-in expired or changed. Start again.", 409);
    if (secret.nextPollAt > Date.now()) return { pending: true, retryAfter: Math.ceil((secret.nextPollAt - Date.now()) / 1000) };
    const response = await oauth(row.tenantId, "token", { client_id: row.clientId, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: secret.deviceCode });
    if (["authorization_pending", "slow_down"].includes(String(response.data.error))) {
      if (response.data.error === "slow_down") secret.interval = Math.min(60, secret.interval + 5);
      secret.nextPollAt = Date.now() + secret.interval * 1000;
      await tx.mailboxConnection.update({ where: { id: row.id }, data: { secretCiphertext: sealMailbox(context.organizationId, secret) } });
      return { pending: true, retryAfter: secret.interval };
    }
    if (!response.ok || typeof response.data.access_token !== "string" || typeof response.data.refresh_token !== "string" || !String(response.data.scope).split(" ").some(scope => scope === "Mail.ReadBasic" || scope.endsWith("/Mail.ReadBasic"))) throw new ApiRequestError("MAILBOX_SIGNIN_FAILED", "Microsoft sign-in was declined, expired or did not grant the required read-only permission.", 409);
    const profile = await graph("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", response.data.access_token);
    const tokens: Tokens = { kind: "tokens", accessToken: response.data.access_token, refreshToken: response.data.refresh_token, expiresAt: Date.now() + Math.max(60, Math.min(86400, Number(response.data.expires_in) || 3600)) * 1000, account: String(profile.mail || profile.userPrincipalName || "Connected Microsoft account").slice(0, 254) };
    await tx.mailboxConnection.update({ where: { id: row.id }, data: { secretCiphertext: sealMailbox(context.organizationId, tokens), enabled: true, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "MailboxConnection", entityId: row.id, eventType: "mailbox_connected_read_only", actorId: context.userId, actorName: context.displayName, sourceModule: "admin" } });
    return { pending: false, connected: true };
  }, { timeout: 40000 });
}
export async function changeMailboxConnection(context: AgentContext, action: "enable" | "disable" | "disconnect") {
  administrator(context);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mailbox:${context.organizationId}`}))`;
    const row = await tx.mailboxConnection.findUnique({ where: { organizationId: context.organizationId } });
    if (!row) throw new ApiRequestError("MAILBOX_NOT_CONFIGURED", "No mailbox is configured.", 409);
    if (action === "enable" && (!row.secretCiphertext || openMailbox(context.organizationId, row.secretCiphertext).kind !== "tokens")) throw new ApiRequestError("MAILBOX_RECONNECT", "Connect an account first.", 409);
    await tx.mailboxConnection.update({ where: { id: row.id }, data: { enabled: action === "enable", ...(action === "disconnect" ? { secretCiphertext: null } : {}), revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "MailboxConnection", entityId: row.id, eventType: `mailbox_${action}`, actorId: context.userId, actorName: context.displayName, sourceModule: "admin" } });
  });
}
async function accessToken(organizationId: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mailbox:${organizationId}`}))`;
    const row = await tx.mailboxConnection.findUnique({ where: { organizationId } });
    if (!row?.enabled || !row.secretCiphertext) throw new ApiRequestError("MAILBOX_DISABLED", "Connect and enable a read-only mailbox in Settings first.", 409);
    const tokens = openMailbox(organizationId, row.secretCiphertext);
    if (tokens.kind !== "tokens") throw new ApiRequestError("MAILBOX_RECONNECT", "Complete Microsoft sign-in first.", 409);
    if (tokens.expiresAt < Date.now() + 60000) {
      const response = await oauth(row.tenantId, "token", { client_id: row.clientId, grant_type: "refresh_token", refresh_token: tokens.refreshToken, scope: SCOPES });
      if (!response.ok || typeof response.data.access_token !== "string") throw new ApiRequestError("MAILBOX_RECONNECT", "Mailbox authorization expired or was revoked. Reconnect the account.", 409);
      tokens.accessToken = response.data.access_token;
      if (typeof response.data.refresh_token === "string") tokens.refreshToken = response.data.refresh_token;
      tokens.expiresAt = Date.now() + Math.max(60, Math.min(86400, Number(response.data.expires_in) || 3600)) * 1000;
      await tx.mailboxConnection.update({ where: { id: row.id }, data: { secretCiphertext: sealMailbox(organizationId, tokens) } });
    }
    return tokens.accessToken;
  }, { timeout: 25000 });
}

export interface ReplyCandidate { messageId: string; subject: string; sender: string; receivedAt: string; backorderId: string; poNumber: string; webLink: string | null }
export async function supplierReplyCandidates(organizationId: string, days: number, signal?: AbortSignal) {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new ApiRequestError("MAILBOX_RANGE", "Choose 1–30 days to check.", 400);
  const token = await accessToken(organizationId);
  const backorders = await prisma.backorder.findMany({ where: { organizationId, resolvedAt: null, dismissedAt: null, supplier: { organizationId } }, include: { supplier: { select: { email: true } }, purchaseOrder: { select: { poNumber: true } } }, take: 1000 });
  const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  url.searchParams.set("$select", "id,subject,from,receivedDateTime,webLink"); url.searchParams.set("$top", "100");
  url.searchParams.set("$filter", `receivedDateTime ge ${new Date(Date.now() - days * 86400000).toISOString()}`); url.searchParams.set("$orderby", "receivedDateTime desc");
  let next: string | null = url.href, scanned = 0;
  const candidates: ReplyCandidate[] = [], seen = new Set<string>();
  for (let page = 0; page < 3 && next; page++) {
    signal?.throwIfAborted();
    const connection = await prisma.mailboxConnection.findUnique({ where: { organizationId }, select: { enabled: true } });
    if (!connection?.enabled) throw new ApiRequestError("MAILBOX_DISABLED", "Mailbox monitoring was disabled.", 409);
    const response = await graph(next, token, signal);
    if (!Array.isArray(response.value) || response.value.length > 100) throw new ApiRequestError("MAILBOX_RESPONSE_INVALID", "Mailbox response exceeded its requested limits.", 502);
    for (const message of response.value) {
      scanned++;
      if (typeof message.id !== "string" || message.id.length > 1024 || seen.has(message.id)) continue;
      seen.add(message.id);
      const subject = typeof message.subject === "string" ? message.subject.slice(0, 500) : "", sender = String(message.from?.emailAddress?.address ?? "").trim().toLowerCase();
      if (!Number.isFinite(Date.parse(message.receivedDateTime))) continue;
      for (const backorder of backorders) {
        const email = backorder.supplier?.email?.trim().toLowerCase(), poNumber = backorder.purchaseOrder.poNumber;
        const escaped = poNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!email || sender !== email || !new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(subject)) continue;
        let webLink: string | null = null;
        try { const link = new URL(message.webLink); if (link.protocol === "https:" && ["outlook.office.com", "outlook.office365.com", "outlook.live.com"].includes(link.hostname)) webLink = link.href; } catch { /* No provider link is preferable to an untrusted link. */ }
        candidates.push({ messageId: message.id, subject, sender, receivedAt: new Date(message.receivedDateTime).toISOString(), backorderId: backorder.id, poNumber, webLink });
      }
    }
    next = typeof response["@odata.nextLink"] === "string" ? response["@odata.nextLink"] : null;
  }
  const reviewed = await prisma.mailboxReply.findMany({ where: { organizationId, messageId: { in: candidates.map(row => row.messageId) } }, select: { messageId: true, backorderId: true, status: true } });
  return { scanned, lookbackDays: days, truncated: Boolean(next) || backorders.length === 1000, candidates: candidates.filter(row => !reviewed.some(review => review.messageId === row.messageId && review.backorderId === row.backorderId)), note: "Possible replies matched by recorded supplier email and order reference. Sender addresses are not proof of identity. Review the original message; no backorder is closed and no email is sent.", _execution: { provider: "microsoft365", model: "read-only-mail-metadata" } };
}
