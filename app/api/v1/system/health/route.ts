import { NextResponse } from "next/server";
import { getAIConfig, isAIConfigured } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { getLocalStorageRoot } from "@/lib/storage/local-object-storage";

export async function GET() {
  const checks = {
    database: { ok: false, label: "Postgres", detail: "Not checked" },
    ai: { ok: isAIConfigured(), label: "Private AI", detail: isAIConfigured() ? "Configured" : "Keyword fallback available" },
    commandRouter: { ok: true, label: "Command Router", detail: "Available" },
    storage: { ok: false, label: "Local Storage", detail: "Not checked" },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, label: "Postgres", detail: "Connected" };
  } catch {
    checks.database = { ok: false, label: "Postgres", detail: "Unavailable" };
  }

  try {
    const storageRoot = getLocalStorageRoot();
    await mkdir(storageRoot, { recursive: true });
    await access(storageRoot, constants.R_OK | constants.W_OK);
    checks.storage = { ok: true, label: "Local Storage", detail: "Accessible" };
  } catch {
    checks.storage = { ok: false, label: "Local Storage", detail: "Unavailable" };
  }
  checks.commandRouter.ok = checks.database.ok;
  checks.commandRouter.detail = checks.database.ok ? "Available" : "Database unavailable";
  const healthy = checks.database.ok && checks.storage.ok;

  const config = getAIConfig();
  return NextResponse.json({
    ok: healthy,
    data: {
      checks,
      mode: checks.ai.ok ? "private_ai" : "fallback",
      provider: config.provider === "none" ? "none" : "private",
      generatedAt: new Date().toISOString(),
    },
  }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
