import type { Prisma } from "@prisma/client";
import type { RfqReview } from "@/lib/rfq/review";
import { prisma } from "@/lib/prisma";
import type { RFQProcessResult, SupplierMatch } from "@/lib/ai/services/rfq";
import { retainSourceDocument, discardUnreferencedSources, type SourceUpload } from "@/lib/documents/source-storage";

export interface PersistRFQOptions {
  organizationId: string;
  documentText: string;
  source: "ai_provider" | "deterministic_prisma";
  model: string;
  provider: string;
  fileName?: string | null;
  warnings?: string[];
  requestKey?: string | null;
  vessel?: string;
  port?: string;
  neededBy?: string;
  sourceUpload?: SourceUpload;
}


function confidenceBand(confidence: SupplierMatch["matchConfidence"] | undefined) {
  if (confidence === "HIGH") return "high";
  if (confidence === "MEDIUM") return "medium";
  return "low";
}

function summarizeDocument(documentText: string) {
  const compact = documentText.replace(/\s+/g, " ").trim();
  return compact.slice(0, 240);
}

export async function persistRFQProcessResult(
  result: RFQProcessResult,
  options: PersistRFQOptions,
): Promise<RFQProcessResult & { rfqId: string; matchRunId: string | null; matchRunIds: string[]; agentRunId: string; persisted: true }> {
  const startedAt = Date.now();

  const sourceDocument = await retainSourceDocument(options.organizationId, options.documentText, options.sourceUpload);
  const review: RfqReview = { version:1, sourceText:options.documentText, fileName:options.fileName ?? null, sourceDocument,
    sourceKind:options.source === "ai_provider" ? "model" : "parser", warnings:options.warnings ?? [],
    originals:result.lines.map(l=>l.originalItem), itemNumbers:result.lines.map(l=>l.originalItem.itemNumber), currencies:result.lines.map(l=>l.originalItem.currency ?? ""),
    selectedLine:0, status:"pending", decisionAt:null, decisionBy:null, requestKey:options.requestKey ?? null, edits:[] };
  try {
  return await prisma.$transaction(async (tx) => {
    const rfq = await tx.rfq.create({
      data: {
        organizationId: options.organizationId,
        review: review as unknown as Prisma.InputJsonValue,
        vessel: options.vessel?.trim() || "Unassigned Vessel",
        port: options.port?.trim() || "Unassigned Port",
        neededBy: options.neededBy?.trim() || "",
        source: options.source === "ai_provider" ? "ai_upload" : "local_upload",
        lines: {
          create: result.lines.map((line, index) => ({
            lineNumber: index + 1,
            description: line.originalItem.specifications,
            quantity: line.originalItem.quantity,
            unit: line.originalItem.unit,
            impaCode: line.supplierOptions[0]?.impaCode || null,
            normalizedDesc: line.originalItem.specifications.toLowerCase(),
          })),
        },
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });

    const documentSummary = summarizeDocument(options.documentText);

    const persistedLines = await Promise.all(result.lines.map(async (line, lineIndex) => {
      const rfqLine = rfq.lines[lineIndex];
      const matchRun = await tx.matchRun.create({
        data: {
          query: {
            organizationId: options.organizationId,
            rfqId: rfq.id,
            rfqLineId: rfqLine?.id ?? null,
            lineNumber: rfqLine?.lineNumber ?? lineIndex + 1,
            itemNumber: line.originalItem.itemNumber,
            description: line.originalItem.specifications,
            vessel: rfq.vessel,
            port: rfq.port,
            neededBy: rfq.neededBy,
            summary: result.summary,
            documentSummary,
          },
          source: "rfq_process_line",
          status: "Ranked",
          candidateCount: line.supplierOptions.length,
        },
      });

      const enrichedOptions = await Promise.all(line.supplierOptions.map(async (option) => {
        const supplier = option.supplierId
          ? await tx.supplier.findFirst({ where: { id: option.supplierId, organizationId: options.organizationId } })
          : await tx.supplier.findFirst({
            where: {
              organizationId: options.organizationId,
              name: { equals: option.supplierName, mode: "insensitive" },
            },
          });

        if (supplier && rfqLine) {
          await tx.supplierQuote.create({
            data: {
              supplierId: supplier.id,
              rfqLineId: rfqLine.id,
              description: line.originalItem.specifications,
              unitPrice: option.price,
              currency: option.currency || "EUR",
              leadTimeDays: option.leadTimeDays,
              stockStatus: option.stockStatus,
            },
          });
        }

        // A binary exact-match rule, not a probabilistic confidence estimate.
        const score = options.source === "deterministic_prisma" && option.matchMethod === "DIRECT" ? 1 : 0;
        const candidate = await tx.matchCandidate.create({
          data: {
            runId: matchRun.id,
            rank: option.rank,
            sourceTag: options.source === "ai_provider" ? "rfq_ai_provider" : "rfq_prisma_fallback",
            name: option.supplierName,
            region: supplier?.region ?? null,
            country: supplier?.country ?? null,
            city: supplier?.city ?? null,
            address: supplier?.address ?? null,
            phone: supplier?.phone ?? null,
            email: supplier?.email ?? null,
            website: supplier?.website ?? null,
            contactPerson: supplier?.contactPerson ?? null,
            description: supplier?.description ?? option.reasoning,
            categories: supplier?.categories ?? [],
            portsCovered: supplier?.portsCovered ?? [],
            lat: supplier?.lat ?? null,
            lng: supplier?.lng ?? null,
            overallScore: score,
            confidenceBand: confidenceBand(option.matchConfidence),
            scoreBreakdown: {
              confidence: option.matchConfidence,
              method: option.matchMethod,
              price: option.price,
              leadTimeDays: option.leadTimeDays,
            },
            explanation: option.reasoning,
            missingFields: supplier ? [] : ["supplier_profile"],
            existingSupplierId: supplier?.id ?? null,
          },
        });

        return {
          ...option,
          supplierId: supplier?.id ?? option.supplierId,
          matchRunId: matchRun.id,
          matchCandidateId: candidate.id,
        };
      }));

      return {
        line: { ...line, supplierOptions: enrichedOptions },
        matchRunId: matchRun.id,
        candidateCount: line.supplierOptions.length,
      };
    }));
    const enrichedLines = persistedLines.map((item) => item.line);
    const matchRunIds = persistedLines.map((item) => item.matchRunId);
    const totalCandidates = persistedLines.reduce((sum, item) => sum + item.candidateCount, 0);

    const agentRun = await tx.agentRun.create({
      data: {
        organizationId: options.organizationId,
        agent: "rfq_intake",
        domain: "procurement",
        trigger: "module",
        status: "Completed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        tasks: {
          create: {
            agent: "rfq_intake",
            action: "extract_rfq_draft",
            input: { rfqId: rfq.id, matchRunIds, source: options.source },
            output: { lines: result.lines.length, candidates: totalCandidates, reviewRequired: true },
            status: "Completed",
            confidence: null,
            model: options.model,
            provider: options.provider,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt,
          },
        },
        auditLogs: {
          create: {
            agent: "rfq_intake",
            action: "persist_rfq_process_result",
            target: rfq.id,
            input: { source: options.source },
            output: { rfqId: rfq.id, matchRunIds },
            model: options.model,
            provider: options.provider,
            durationMs: Date.now() - startedAt,
            committed: true,
          },
        },
      },
    });

    return {
      ...result,
      lines: enrichedLines,
      rfqId: rfq.id,
      matchRunId: matchRunIds[0] ?? null,
      matchRunIds,
      agentRunId: agentRun.id,
      persisted: true,
      review,
      updatedAt: rfq.updatedAt.toISOString(),
    };
  });
  } catch (error) {
    await discardUnreferencedSources([sourceDocument]);
    throw error;
  }
}
