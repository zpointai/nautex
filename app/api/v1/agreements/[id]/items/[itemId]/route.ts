/**
 * Agreement Item Detail API
 *
 * PATCH  /api/v1/agreements/:id/items/:itemId  — update item fields
 * DELETE /api/v1/agreements/:id/items/:itemId  — remove item from version
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/* ── PATCH — Update item ───────────────────────────────────────── */

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, itemId } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  const body = await req.json();

  // Verify item belongs to version
  const existing = await prisma.agreementItem.findFirst({
    where: { id: itemId, versionId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const {
    description, offiNumber, systemId, vendorPartNumber,
    basePrice, markedUpPrice, currency, unit, moq,
    leadTimeDays, hsCode, countryOfOrigin, cooConfidence, manufacturer,
  } = body;

  // Normalize HS code → 8-digit TARIC (digits only)
  const normalizedHs = hsCode == null
    ? hsCode
    : String(hsCode).replace(/\D/g, "").slice(0, 8) || null;

  // Normalize COO → ISO 3166-1 alpha-3 (uppercase letters only, max 3)
  const normalizedCoo = countryOfOrigin == null
    ? countryOfOrigin
    : String(countryOfOrigin).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || null;

  // Validate confidence
  const normalizedConf =
    cooConfidence === undefined ? undefined :
    cooConfidence === null ? null :
    ["High", "Medium", "Low"].includes(String(cooConfidence)) ? String(cooConfidence) : null;

  const updated = await prisma.agreementItem.update({
    where: { id: itemId },
    data: {
      ...(description !== undefined && { description }),
      ...(offiNumber !== undefined && { offiNumber }),
      ...(systemId !== undefined && { systemId }),
      ...(vendorPartNumber !== undefined && { vendorPartNumber }),
      ...(basePrice !== undefined && { basePrice: Number(basePrice) }),
      ...(markedUpPrice !== undefined && { markedUpPrice: Number(markedUpPrice) }),
      ...(currency !== undefined && { currency }),
      ...(unit !== undefined && { unit }),
      ...(moq !== undefined && { moq: moq !== null ? Number(moq) : null }),
      ...(leadTimeDays !== undefined && { leadTimeDays: leadTimeDays !== null ? Number(leadTimeDays) : null }),
      ...(hsCode !== undefined && { hsCode: normalizedHs }),
      ...(countryOfOrigin !== undefined && { countryOfOrigin: normalizedCoo }),
      ...(normalizedConf !== undefined && { cooConfidence: normalizedConf }),
      ...(manufacturer !== undefined && { manufacturer }),
    },
  });

  // Recalculate version totals
  const allItems = await prisma.agreementItem.findMany({
    where: { versionId: id },
    select: { basePrice: true, markedUpPrice: true },
  });
  const totalBase = allItems.reduce((s, i) => s + (i.basePrice || 0), 0);
  const totalMarkup = allItems.reduce((s, i) => s + (i.markedUpPrice || 0), 0);
  await prisma.agreementVersion.update({
    where: { id },
    data: {
      totalBaseValue: Math.round(totalBase * 100) / 100,
      totalMarkedUpValue: Math.round(totalMarkup * 100) / 100,
    },
  });

  return NextResponse.json({ item: updated });
}

/* ── DELETE — Remove item ──────────────────────────────────────── */

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, itemId } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });

  const existing = await prisma.agreementItem.findFirst({
    where: { id: itemId, versionId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  await prisma.agreementItem.delete({ where: { id: itemId } });

  // Recalculate version totals
  const allItems = await prisma.agreementItem.findMany({
    where: { versionId: id },
    select: { basePrice: true, markedUpPrice: true },
  });
  const totalBase = allItems.reduce((s, i) => s + (i.basePrice || 0), 0);
  const totalMarkup = allItems.reduce((s, i) => s + (i.markedUpPrice || 0), 0);
  await prisma.agreementVersion.update({
    where: { id },
    data: {
      totalBaseValue: Math.round(totalBase * 100) / 100,
      totalMarkedUpValue: Math.round(totalMarkup * 100) / 100,
    },
  });

  return NextResponse.json({ deleted: true });
}
