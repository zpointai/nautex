import { NextResponse } from "next/server";
import { getAIConfig, isAIConfigured } from "@/lib/ai";

/**
 * GET /api/v1/ai/status
 *
 * Returns current server-side AI configuration status.
 * Never exposes actual API keys.
 */
export async function GET() {
  const config = getAIConfig();

  return NextResponse.json({
    configured: isAIConfigured(),
    provider: config.provider === "none" ? "none" : "private",
    defaultModel: config.provider === "none" ? "" : "default",
    fastModel: config.provider === "none" ? "" : "fast",
    reasoningModel: config.provider === "none" ? "" : "reasoning",
    hasPrivateKey: isAIConfigured(),
    hasVertexConfig: !!(config.vertexProject && config.vertexLocation),
  });
}
