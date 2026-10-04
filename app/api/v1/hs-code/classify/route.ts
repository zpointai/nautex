import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { classifyProduct, verifyCode } from "@/lib/ai/services/hs-code";
import { datasetClassification, findHsMatches } from "@/lib/datasets/hs-codes";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { prisma } from "@/lib/prisma";
import { assertAgentEnabled } from "@/lib/agents/controls";

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "classification");
    const body = await readJsonObject(req, 32_768);
    const type = body.type;
    if (type !== "text" && type !== "verify") {
      return NextResponse.json({ error: "Invalid classification type." }, { status: 400 });
    }
    const description = type === "text" ? body.description : body.itemDescription;
    if (typeof description !== "string" || !description.trim() || description.length > 8_000) {
      return NextResponse.json({ error: "A product description of 1–8,000 characters is required." }, { status: 400 });
    }
    if (type === "verify" && (typeof body.code !== "string" || !/^\d[\d. ]{3,16}$/.test(body.code))) {
      return NextResponse.json({ error: "A valid HS code is required." }, { status: 400 });
    }
    const code = typeof body.code === "string" ? body.code : "";
    const dataset = type === "text" ? datasetClassification(description, await findHsMatches(description, 5)) : null;
    // Code existence alone does not verify that it applies to this product.
    const result = dataset
      ? { ok: true as const, data: dataset, model: "local-hs-dataset", provider: "postgres" }
      : type === "text" ? await classifyProduct(description, { organizationId: authorization.context.organizationId, signal: req.signal }) : await verifyCode(code, description, { organizationId: authorization.context.organizationId, signal: req.signal });
    if (!result.ok || !result.data) {
      return NextResponse.json({ error: "Classification is unavailable. Connect an AI provider in Settings or import an applicable HS dataset. No customs classification has been generated." }, { status: 503 });
    }
    const query = type === "text" ? description : { code, description };
    const data = { id: crypto.randomUUID(), query, ...result.data };
    const history = await prisma.$transaction(async tx => {
    const saved = await tx.hsCodeHistory.create({
      data: {
        organizationId: authorization.context.organizationId,
        userId: authorization.context.userId,
        type: type === "text" ? "classification" : "verification",
        query,
        result: data as object,
        code: "eu" in result.data ? result.data.eu.code || null : result.data.suggestedCode ?? code,
        model: result.model,
        provider: result.provider,
      },
    });
    await tx.agentRun.create({ data: {
      organizationId: authorization.context.organizationId, agent: "classification", domain: "classification", trigger: "module", status: "Completed", completedAt: new Date(),
      tasks: { create: { agent: "classification", action: type === "text" ? "classify_hs" : "verify_hs", input: { historyId: saved.id }, output: data as object, status: "Completed", confidence: null, provider: result.provider, model: result.model, completedAt: new Date() } },
      auditLogs: { create: { agent: "classification", action: "hs_result_recorded", target: saved.id, provider: result.provider, model: result.model, committed: false } },
    } });
    return saved;
    });
    return NextResponse.json({ data: {
      type: type === "text" ? "classification" : "verification",
      historyId: history.id,
      data,
      ...(dataset ? { _dataset: true } : { _ai: { model: result.model, provider: result.provider } }),
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiRequestError ? error.message : "Classification failed." }, { status: error instanceof ApiRequestError ? error.status : 500 });
  }
}
