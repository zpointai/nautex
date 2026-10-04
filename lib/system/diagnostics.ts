import { access, lstat, readFile, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getAIConfig, isAIConfigured } from "@/lib/ai";
import { AI_PROVIDER_MODELS } from "@/lib/ai/config";
import { getBackupRoot, getLocalStorageRoot } from "@/lib/storage/local-object-storage";
import desktopPackage from "../../desktop/package.json";

export interface SupportCheck { name: string; status: "pass" | "warning" | "failed" | "not_tested"; detail: string; action: string }
async function receipt(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error("Invalid backup receipt");
  const value = JSON.parse(await readFile(file, "utf8"));
  if (value.version !== 1 || typeof value.verifiedAt !== "string" || !Number.isFinite(Date.parse(value.verifiedAt)) || Date.parse(value.verifiedAt) > Date.now() + 60_000) throw new Error("Invalid backup receipt");
  return { verifiedAt: new Date(value.verifiedAt).toISOString(), ageHours: Math.floor((Date.now() - Date.parse(value.verifiedAt)) / 3_600_000) };
}
// Export only these explicit fields. Never attach environment variables, logs, paths,
// connection strings, document content, account names or provider-key previews.
export async function supportDiagnostics() {
  const checks: SupportCheck[] = [];
  const started = Date.now();
  try { await prisma.$queryRaw`SELECT 1`; checks.push({ name: "Database", status: "pass", detail: `Responded in ${Date.now() - started} ms.`, action: "No action needed." }); }
  catch { checks.push({ name: "Database", status: "failed", detail: "Database is unavailable.", action: "Restart Nautex. If the problem persists, preserve your workspace and contact support." }); }
  let freeBytes: number | null = null;
  try {
    const storage = getLocalStorageRoot();
    await access(storage, constants.R_OK | constants.W_OK);
    const disk = await statfs(storage); freeBytes = Number(disk.bavail) * Number(disk.bsize);
    checks.push({ name: "Storage", status: freeBytes < 2 * 1024 ** 3 ? "warning" : "pass", detail: `${(freeBytes / 1024 ** 3).toFixed(1)} GB available.`, action: freeBytes < 2 * 1024 ** 3 ? "Free space before imports or backups; preserve company data." : "No action needed." });
  } catch { checks.push({ name: "Storage", status: "failed", detail: "Local document storage cannot be accessed.", action: "Check drive availability and Windows permissions. Do not reset the workspace." }); }
  let backup: { verifiedAt: string; ageHours: number } | null = null;
  try {
    backup = await receipt(path.join(getBackupRoot(), "backup-status.json"));
    checks.push({ name: "Local backup", status: backup.ageHours > 24 ? "warning" : "pass", detail: `Verified when created: ${backup.verifiedAt}.`, action: backup.ageHours > 24 ? "Create a fresh backup from the Workspace menu." : "Restore rechecks all snapshot contents; keep backups on a protected drive." });
  } catch { checks.push({ name: "Local backup", status: "not_tested", detail: "No valid backup verification receipt is available.", action: "Create and verify a backup from the Workspace menu. Older backups may still exist." }); }
  let portable: { verifiedAt: string; ageHours: number } | null = null;
  try {
    portable = await receipt(path.join(getBackupRoot(), "portable-recovery-status.json"));
    checks.push({ name: "Portable recovery", status: "warning", detail: `Encrypted copy created: ${portable.verifiedAt}. Destination availability and replacement-PC restore are not checked here.`, action: "Keep its password separately and rehearse restoration on a separate test machine." });
  } catch { checks.push({ name: "Portable recovery", status: "not_tested", detail: "No portable recovery copy is recorded.", action: "Use Workspace → Create portable recovery copy. A local backup alone depends on this Windows profile." }); }
  let provider = "unknown", model = "unknown", configured = false;
  try {
    const config = getAIConfig(); provider = config.provider; configured = isAIConfigured(config);
    const known = Object.values(AI_PROVIDER_MODELS).flatMap(tiers => Object.values(tiers));
    model = known.includes(config.defaultModel) ? config.defaultModel : "custom";
    checks.push({ name: "AI provider", status: "not_tested", detail: configured ? `${provider} is configured; live connectivity and credit were not checked.` : "No AI credentials configured; supported local actions remain available.", action: configured ? "Use the explicit connection test in AI settings when needed; it may use provider credit." : "Configure AI settings if this workflow needs a provider." });
  } catch { checks.push({ name: "AI provider", status: "failed", detail: "AI settings could not be read.", action: "Review AI settings. Do not include API keys in a support request." }); }
  return { formatVersion: 1, applicationVersion: desktopPackage.version, generatedAt: new Date().toISOString(), runtime: { platform: process.platform, architecture: process.arch, node: process.versions.node, uptimeSeconds: Math.floor(process.uptime()) }, checks, freeBytes, backup, portable, provider: { name: provider, model, configured, liveConnectivity: "not_tested" }, privacy: "Contains selected technical status only; no credentials, paths, logs or business documents." };
}
