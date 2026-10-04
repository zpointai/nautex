/**
 * GET   /api/v1/suppliers/match/:runId — Get match run details + all candidates
 * PATCH /api/v1/suppliers/match/:runId — Accept/reject/edit a candidate
 */

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { recordFeedback } from "@/lib/matching";

const prisma = new PrismaClient();

/* ── GET: Full run details ───────────────────────────────────── */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const { runId } = await params;

  const run = await prisma.matchRun.findFirst({
    where: {
      id: runId,
      query: { path: ["organizationId"], equals: authorization.context.organizationId },
    },
    include: {
      candidates: { orderBy: { rank: "asc" } },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Match run not found" }, { status: 404 });
  }

  return NextResponse.json({ data: run });
}

/* ── PATCH: Accept / Reject / Edit candidate ─────────────────── */

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
  if (!authorization.ok) return authorization.response;
  const { runId } = await params;
  const body = await req.json();

  const { candidateId, action, correctedFields, rejectionReason } = body as {
    candidateId: string;
    action: "accept" | "reject" | "edit_accept";
    correctedFields?: Record<string, { from: unknown; to: unknown }>;
    rejectionReason?: string;
  };

  if (!candidateId || !action) {
    return NextResponse.json({ error: "candidateId and action are required" }, { status: 400 });
  }

  // Validate the run exists and is in a reviewable state
  const run = await prisma.matchRun.findFirst({
    where: {
      id: runId,
      query: { path: ["organizationId"], equals: authorization.context.organizationId },
    },
  });
  if (!run) {
    return NextResponse.json({ error: "Match run not found" }, { status: 404 });
  }

  if (run.status !== "Ranked" && run.status !== "Running") {
    return NextResponse.json(
      { error: `Run is in '${run.status}' state and cannot accept feedback` },
      { status: 400 },
    );
  }

  // Validate the candidate belongs to this run
  const candidate = await prisma.matchCandidate.findFirst({
    where: { id: candidateId, runId },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found in this run" }, { status: 404 });
  }

  // Record feedback for learning
  await recordFeedback({
    runId,
    candidateId,
    action,
    correctedFields,
    rejectionReason,
  });

  if (action === "accept" || action === "edit_accept") {
    // Mark candidate as accepted
    const outcome = action === "accept" ? "Accepted" : "AcceptedWithEdits";
    await prisma.matchCandidate.update({
      where: { id: candidateId },
      data: {
        outcome,
        userEdits: correctedFields ? (correctedFields as object) : undefined,
      },
    });

    // Mark other candidates as rejected
    await prisma.matchCandidate.updateMany({
      where: { runId, id: { not: candidateId } },
      data: { outcome: "Rejected" },
    });

    // Build supplier data from candidate + user edits
    const supplierData = buildSupplierFromCandidate(candidate, correctedFields);

    let savedSupplierId: string;

    if (candidate.existingSupplierId) {
      // Update existing supplier
      const updated = await prisma.supplier.updateMany({
        where: { id: candidate.existingSupplierId, organizationId: authorization.context.organizationId },
        data: supplierData,
      });
      if (updated.count !== 1) {
        return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
      }
      savedSupplierId = candidate.existingSupplierId;
    } else {
      // Create new supplier
      const maxCode = await prisma.supplier.findFirst({
        where: { organizationId: authorization.context.organizationId },
        orderBy: { supplierCode: "desc" },
        select: { supplierCode: true },
      });
      const nextNum = maxCode
        ? parseInt(maxCode.supplierCode.replace("SUP-", "")) + 1
        : 1;
      const supplierCode = `SUP-${String(nextNum).padStart(4, "0")}`;

      const created = await prisma.supplier.create({
        data: {
          organizationId: authorization.context.organizationId,
          supplierCode,
          name: supplierData.name as string,
          region: (supplierData.region as string) || "Unknown",
          country: supplierData.country as string | null,
          city: supplierData.city as string | null,
          address: supplierData.address as string | null,
          phone: supplierData.phone as string | null,
          email: supplierData.email as string | null,
          website: supplierData.website as string | null,
          contactPerson: supplierData.contactPerson as string | null,
          description: supplierData.description as string | null,
          categories: supplierData.categories as string[] ?? [],
          portsCovered: supplierData.portsCovered as string[] ?? [],
          lat: supplierData.lat as number | null,
          lng: supplierData.lng as number | null,
          status: "Suggested",
          enrichmentStatus: "None",
          score: computeScore(supplierData),
        },
      });
      savedSupplierId = created.id;
    }

    // Update run status
    await prisma.matchRun.update({
      where: { id: runId },
      data: {
        status: "Accepted",
        acceptedCandidateId: candidateId,
        savedSupplierId,
      },
    });

    return NextResponse.json({
      status: "accepted",
      candidateId,
      savedSupplierId,
      outcome,
    });
  }

  if (action === "reject") {
    await prisma.matchCandidate.update({
      where: { id: candidateId },
      data: {
        outcome: "Rejected",
      },
    });

    // Check if all candidates are now rejected
    const pending = await prisma.matchCandidate.count({
      where: { runId, outcome: "Pending" },
    });

    if (pending === 0) {
      await prisma.matchRun.update({
        where: { id: runId },
        data: { status: "AllRejected" },
      });
    }

    return NextResponse.json({
      status: "rejected",
      candidateId,
      remainingPending: pending,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/* ── Helpers ─────────────────────────────────────────────────── */

function buildSupplierFromCandidate(
  candidate: {
    name: string; region: string | null; country: string | null;
    city: string | null; address: string | null; phone: string | null;
    email: string | null; website: string | null; contactPerson: string | null;
    description: string | null; categories: string[]; portsCovered: string[];
    lat: number | null; lng: number | null;
  },
  edits?: Record<string, { from: unknown; to: unknown }>,
) {
  const data: Record<string, unknown> = {
    name: candidate.name,
    region: candidate.region ?? "",
    country: candidate.country,
    city: candidate.city,
    address: candidate.address,
    phone: candidate.phone,
    email: candidate.email,
    website: candidate.website,
    contactPerson: candidate.contactPerson,
    description: candidate.description,
    categories: candidate.categories,
    portsCovered: candidate.portsCovered,
    lat: candidate.lat,
    lng: candidate.lng,
  };

  // Apply user corrections
  if (edits) {
    for (const [field, change] of Object.entries(edits)) {
      if (field in data) {
        data[field] = change.to;
      }
    }
  }

  return data;
}

function computeScore(data: Record<string, unknown>): number {
  const weights: Record<string, number> = {
    name: 10, region: 8, country: 8, city: 5, address: 5,
    email: 10, phone: 8, website: 8, contactPerson: 8,
    description: 10, categories: 10, portsCovered: 5, lat: 3, lng: 2,
  };

  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const val = data[field];
    if (val !== null && val !== undefined && val !== "") {
      if (Array.isArray(val) && val.length === 0) continue;
      score += weight;
    }
  }
  return score;
}
