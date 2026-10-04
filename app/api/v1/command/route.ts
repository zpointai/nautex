import { executeCommand } from "@/lib/ai/engine";
import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";

/**
 * POST /api/v1/command
 *
 * Entry point for all command-triggered agent workflows.
 * Accepts natural-language commands, routes to the correct agent,
 * and returns the execution result.
 */
export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = await readJsonObject(req, 32_768);
    const { command } = body;

    if (typeof command !== "string" || !command.trim() || command.length > 16_000) {
      return fail("COMMAND_REQUIRED", "Command text is required.", 400);
    }

    const result = await executeCommand(command, authorization.context.organizationId, authorization.context);

    // Record in command history
    await prisma.commandHistory.create({
      data: {
        organizationId: authorization.context.organizationId,
        command,
        userId: authorization.context.userId,
        routedTo: result.agentId,
        runId: result.runId,
        status: result.status === "awaiting_approval" ? "pending" : result.status,
        resultSummary: result.error || `${result.action} ${result.status}`,
      },
    });

    return ok(result, { source: "agent_engine", status: result.status });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/command", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Can't reach database server") || message.includes("P1001")) {
      return fail(
        "DATABASE_UNAVAILABLE",
        "Command agent storage is unavailable. Start Postgres and retry so Nautex can create an auditable agent run.",
        503,
      );
    }
    return fail("COMMAND_EXECUTION_FAILED", "Command execution failed.");
  }
}
