import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * GET /api/v1/suppliers/:id
 *
 * Returns a single supplier with related counts.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;

    const supplier = await prisma.supplier.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      include: {
        contracts: { orderBy: { startDate: "desc" } },
        _count: {
          select: {
            contracts: true,
            agreementVersions: true,
            supplierQuotes: true,
            purchaseOrders: true,
            supplierInvoices: true,
          },
        },
      },
    });

    if (!supplier) {
      return NextResponse.json({ ok: false, error: { message: "Supplier not found" } }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: supplier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch supplier.";
    return NextResponse.json({ ok: false, error: { message } }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/suppliers/:id
 *
 * Update a supplier's fields.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const body = await req.json();

    const allowed = [
      "name", "region", "country", "city", "address",
      "phone", "email", "website", "contactPerson", "description",
      "categories", "portsCovered",
      "score", "leadTimeDays", "lat", "lng",
      "status", "enrichmentStatus", "confidence", "sourceReferences",
    ];

    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: false, error: { message: "No valid fields to update." } }, { status: 400 });
    }

    const scoreFields = new Set([
      "name", "region", "country", "city", "address",
      "phone", "email", "website", "contactPerson", "description",
      "categories", "portsCovered", "lat", "lng",
    ]);
    const shouldRecalculateScore = data.score === undefined && Object.keys(data).some((key) => scoreFields.has(key));

    if (shouldRecalculateScore) {
      const existing = await prisma.supplier.findFirst({ where: { id, organizationId: authorization.context.organizationId } });
      if (!existing) {
        return NextResponse.json({ ok: false, error: { message: "Supplier not found." } }, { status: 404 });
      }
      data.score = computeProfileScore({ ...existing, ...data });
    }

    const target = await prisma.supplier.findFirst({ where: { id, organizationId: authorization.context.organizationId }, select: { id: true } });
    if (!target) return NextResponse.json({ ok: false, error: { message: "Supplier not found." } }, { status: 404 });
    const supplier = await prisma.supplier.update({
      where: { id: target.id },
      data,
      include: {
        contracts: { orderBy: { startDate: "desc" } },
        _count: {
          select: {
            contracts: true,
            agreementVersions: true,
            supplierQuotes: true,
            purchaseOrders: true,
            supplierInvoices: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, data: supplier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update supplier.";
    return NextResponse.json({ ok: false, error: { message } }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/suppliers/:id
 *
 * Default: soft-delete by setting status to Blocked (preserves history).
 * With ?permanent=true: hard delete — only allowed if supplier is already Blocked.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const url = new URL(req.url);
    const permanent = url.searchParams.get("permanent") === "true";

    if (permanent) {
      // Hard delete — only permitted when already archived (Blocked)
      const existing = await prisma.supplier.findFirst({ where: { id, organizationId: authorization.context.organizationId }, select: { id: true, status: true } });
      if (!existing) {
        return NextResponse.json({ ok: false, error: { message: "Supplier not found." } }, { status: 404 });
      }
      if (existing.status !== "Blocked") {
        return NextResponse.json(
          { ok: false, error: { message: "Supplier must be archived before permanent deletion. Archive it first." } },
          { status: 400 }
        );
      }
      await prisma.supplier.delete({ where: { id: existing.id } });
      return NextResponse.json({ ok: true, deleted: true });
    }

    // Soft-delete: set status to Blocked
    const existing = await prisma.supplier.findFirst({ where: { id, organizationId: authorization.context.organizationId }, select: { id: true } });
    if (!existing) return NextResponse.json({ ok: false, error: { message: "Supplier not found." } }, { status: 404 });
    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: { status: "Blocked" },
    });

    return NextResponse.json({ ok: true, data: supplier });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to archive supplier.";
    return NextResponse.json({ ok: false, error: { message } }, { status: 500 });
  }
}

function computeProfileScore(s: Record<string, unknown>): number {
  let score = 0;
  const checks = [
    { field: "name", weight: 10 },
    { field: "region", weight: 8 },
    { field: "country", weight: 8 },
    { field: "city", weight: 5 },
    { field: "address", weight: 5 },
    { field: "email", weight: 10 },
    { field: "phone", weight: 8 },
    { field: "website", weight: 8 },
    { field: "contactPerson", weight: 8 },
    { field: "description", weight: 10 },
    { field: "categories", weight: 10, isArray: true },
    { field: "portsCovered", weight: 5, isArray: true },
    { field: "lat", weight: 3 },
    { field: "lng", weight: 2 },
  ];

  for (const check of checks) {
    const val = s[check.field];
    if (check.isArray) {
      if (Array.isArray(val) && val.length > 0) score += check.weight;
    } else if (val !== null && val !== undefined && val !== "" && val !== "Unknown") {
      score += check.weight;
    }
  }

  return score;
}
