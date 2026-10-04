import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import {
  createCustomerContract,
  customerContractDetailInclude,
} from "@/lib/agreements/customer-contracts";

export async function GET(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const shippingCompanyId = sp.get("shippingCompanyId");
  const search = sp.get("search");

  const where: Record<string, unknown> = { shippingCompany: { organizationId: authorization.context.organizationId } };
  if (status && status !== "all") where.status = status;
  if (shippingCompanyId) where.shippingCompanyId = shippingCompanyId;
  if (search) {
    where.OR = [
      { contractNumber: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
      { shippingCompanyName: { contains: search, mode: "insensitive" } },
    ];
  }

  const contracts = await prisma.customerContract.findMany({
    where,
    include: {
      shippingCompany: true,
      sourceAgreements: {
        select: { supplierId: true, supplierName: true, includedItemCount: true },
        orderBy: { supplierName: "asc" },
      },
      _count: { select: { items: true, auditEvents: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  const kpis = {
    total: contracts.length,
    active: contracts.filter((contract) => contract.status === "Active").length,
    draft: contracts.filter((contract) => contract.status === "Draft").length,
    underReview: contracts.filter((contract) => contract.status === "UnderReview").length,
    expiring: contracts.filter((contract) => {
      if (contract.status !== "Active" || !contract.validTo) return false;
      const days = Math.ceil((contract.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days > 0 && days <= 45;
    }).length,
    value: Math.round(contracts.reduce((sum, contract) => sum + contract.totalSellValue, 0) * 100) / 100,
  };

  return NextResponse.json({ contracts, kpis });
}

export async function POST(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const body = await req.json();
  const { shippingCompanyId, agreementVersionIds } = body;

  if (!shippingCompanyId) {
    return NextResponse.json({ error: "shippingCompanyId is required" }, { status: 400 });
  }
  if (!Array.isArray(agreementVersionIds) || agreementVersionIds.length === 0) {
    return NextResponse.json({ error: "At least one supplier agreement is required" }, { status: 400 });
  }

  try {
    const contract = await createCustomerContract({
      organizationId: authorization.context.organizationId,
      shippingCompanyId,
      title: body.title,
      markupPercent: body.markupPercent,
      validFrom: body.validFrom,
      validTo: body.validTo,
      paymentTerms: body.paymentTerms,
      deliveryTerms: body.deliveryTerms,
      notes: body.notes,
      agreementVersionIds,
    });

    const full = await prisma.customerContract.findUnique({
      where: { id: contract.id },
      include: customerContractDetailInclude,
    });
    return NextResponse.json({ contract: full }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create contract" }, { status: 400 });
  }
}
