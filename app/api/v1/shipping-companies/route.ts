import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logApiError } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { deleteShippingCompanyWithLinkedOrders } from "@/lib/purchase-orders/order-workflow";
import { Prisma } from "@prisma/client";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail } from "@/lib/api/response";

const editableFields = [
  "website",
  "legalName",
  "address",
  "postalCode",
  "city",
  "country",
  "contactName",
  "email",
  "phone",
  "vatId",
  "companyNumber",
  "paymentTerms",
  "invoiceEmail",
  "notes",
] as const;

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const names = url.searchParams.get("names")?.split("|").map((name) => name.trim()).filter(Boolean) ?? [];

    const profiles = await prisma.shippingCompany.findMany({
      where: { organizationId: authorization.context.organizationId, ...(names.length > 0 ? { name: { in: names } } : {}) },
      orderBy: { name: "asc" },
      include: { fleetVessels: { orderBy: { name: "asc" } } },
    });

    return NextResponse.json({ ok: true, data: profiles, meta: { source: "postgres" } });
  } catch (error) {
    logApiError("GET /api/v1/shipping-companies", error);
    return NextResponse.json(
      { ok: false, error: { code: "SHIPPING_COMPANY_LIST_FAILED", message: "Failed to fetch shipping companies." } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = await readJsonObject(req, 32_768);
    const name = normalizeText(body.name);
    const previousName = normalizeText(body.previousName) ?? name;
    if (!name || name.length > 200) {
      return NextResponse.json(
        { ok: false, error: { code: "SHIPPING_COMPANY_NAME_REQUIRED", message: "Shipping company name is required." } },
        { status: 400 },
      );
    }

    const data: Record<string, string | null> = {};
    for (const field of editableFields) data[field] = normalizeText(body[field]);
    if (data.website) {
      let valid = false;
      try { const url = new URL(data.website); valid = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch {}
      if (!valid || data.website.length > 2000) return fail("COMPANY_WEBSITE_INVALID", "Enter a full http or https website address without login details.", 400);
    }

    const profile = await prisma.$transaction(async (tx) => {
      if (body.createOnly === true) {
        const duplicate = await tx.shippingCompany.findFirst({ where: { organizationId: authorization.context.organizationId, name: { equals: name, mode: "insensitive" } } });
        if (duplicate) throw new ApiRequestError("SHIPPING_COMPANY_EXISTS", "A shipping company with this name already exists. Open its details to edit it.", 409);
        const created = await tx.shippingCompany.create({ data: { organizationId: authorization.context.organizationId, name, ...data, source: "operator" }, include: { fleetVessels: true } });
        await tx.auditEvent.create({ data: { organizationId: authorization.context.organizationId, entityType: "shipping_company", entityId: created.id, eventType: "shipping_company_created", actorId: authorization.context.userId, sourceModule: "purchaseOrders", metadata: { source: "operator" } } });
        return created;
      }
      if (previousName && previousName !== name) {
        await tx.purchaseOrder.updateMany({
          where: { organizationId: authorization.context.organizationId, buyerName: previousName },
          data: { buyerName: name },
        });
        await tx.purchaseOrder.updateMany({
          where: { organizationId: authorization.context.organizationId, vesselOwner: previousName },
          data: { vesselOwner: name },
        });

        const previousProfile = await tx.shippingCompany.findFirst({ where: { name: previousName, organizationId: authorization.context.organizationId } });
        const targetProfile = await tx.shippingCompany.findFirst({ where: { name, organizationId: authorization.context.organizationId } });

        if (targetProfile) {
          throw new ApiRequestError("SHIPPING_COMPANY_EXISTS", "That name belongs to another shipping company. Choose a different name.", 409);
        }

        if (previousProfile) {
          return tx.shippingCompany.update({
            where: { id: previousProfile.id },
            data: { name, ...data, source: "operator" },
            include: { fleetVessels: true },
          });
        }
      }

      const existing = await tx.shippingCompany.findFirst({ where: { name, organizationId: authorization.context.organizationId } });
      return existing
        ? tx.shippingCompany.update({ where: { id: existing.id }, data: { ...data, source: "operator" }, include: { fleetVessels: true } })
        : tx.shippingCompany.create({ data: { organizationId: authorization.context.organizationId, name, ...data, source: body.source === "shipserv" ? "shipserv" : "operator" }, include: { fleetVessels: true } });
    });

    return NextResponse.json({ ok: true, data: profile });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("SHIPPING_COMPANY_EXISTS", "This shipping company name is unavailable. Choose a different name.", 409);
    logApiError("POST /api/v1/shipping-companies", error);
    return NextResponse.json(
      { ok: false, error: { code: "SHIPPING_COMPANY_SAVE_FAILED", message: error instanceof Error ? error.message : "Failed to save shipping company." } },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const name = normalizeText(url.searchParams.get("name"));
    if (!name) {
      return NextResponse.json(
        { ok: false, error: { code: "SHIPPING_COMPANY_NAME_REQUIRED", message: "Shipping company name is required." } },
        { status: 400 },
      );
    }

    const result = await deleteShippingCompanyWithLinkedOrders(name, authorization.context.organizationId);

    return NextResponse.json({
      ok: true,
      data: result,
      meta: { source: "postgres" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "SHIPPING_COMPANY_DELETE_FAILED", message: "Failed to delete shipping company and linked purchase orders." } },
      { status: 500 },
    );
  }
}
