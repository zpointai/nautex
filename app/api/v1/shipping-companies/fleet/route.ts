import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fail, ok } from "@/lib/api/response";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.SUPPLIERS_WRITE);
  if (!authorization.ok) return authorization.response;
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 16_384); } catch (error) { return error instanceof ApiRequestError ? fail(error.code, error.message, error.status) : fail("INVALID_JSON", "Enter valid vessel details.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["id", "shippingCompanyId", "name", "imo", "mmsi", "notes"].includes(k))) return fail("INVALID_FIELDS", "Unsupported vessel fields.", 400);
  if (Object.values(body).some(value => value !== null && typeof value !== "string")) return fail("VESSEL_INVALID", "Vessel fields must contain text.", 400);
  const text = (key: string) => typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const id = text("id"), shippingCompanyId = text("shippingCompanyId"), name = text("name"), imo = text("imo"), mmsi = text("mmsi"), notes = text("notes");
  if (!shippingCompanyId || !name || name.length > 200 || (imo && !/^\d{7}$/.test(imo)) || (mmsi && !/^\d{9}$/.test(mmsi)) || notes.length > 2000) return fail("VESSEL_INVALID", "Enter a vessel name, an optional 7-digit IMO and an optional 9-digit MMSI. Notes may contain up to 2,000 characters.", 400);
  const company = await prisma.shippingCompany.findFirst({ where: { id: shippingCompanyId, organizationId: authorization.context.organizationId }, select: { id: true } });
  if (!company) return fail("SHIPPING_COMPANY_NOT_FOUND", "Shipping company not found.", 404);
  if (id && !await prisma.shippingCompanyVessel.findFirst({ where: { id, shippingCompanyId } })) return fail("VESSEL_NOT_FOUND", "Vessel not found in this fleet.", 404);
  try {
    const data = { name, nameKey: name.toLocaleLowerCase("en-US"), imo: imo || null, mmsi: mmsi || null, notes: notes || null };
    const vessel = await prisma.$transaction(async tx => {
      const saved = id ? await tx.shippingCompanyVessel.update({ where: { id }, data }) : await tx.shippingCompanyVessel.create({ data: { shippingCompanyId, ...data } });
      await tx.auditEvent.create({ data: { organizationId: authorization.context.organizationId, entityType: "shipping_company_vessel", entityId: saved.id, eventType: id ? "fleet_vessel_updated" : "fleet_vessel_created", actorId: authorization.context.userId, sourceModule: "purchaseOrders", metadata: { shippingCompanyId } } });
      return saved;
    });
    return ok(vessel, undefined, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("VESSEL_EXISTS", "A vessel with that name, IMO or MMSI already exists in this fleet. Edit its existing record.", 409);
    return fail("VESSEL_SAVE_FAILED", "The vessel could not be saved. Please try again.", 500);
  }
}
