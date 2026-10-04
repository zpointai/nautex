import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasPermission, type AuthContext } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError } from "@/lib/api/request";

export const normalizeUnit = (value: string) => value.trim().toUpperCase();
export function stockQuantity(orderQuantity: number, factor: Prisma.Decimal | number | string) {
  if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) throw new Error("Order quantity must be positive.");
  const result = new Prisma.Decimal(orderQuantity).mul(factor);
  if (!result.isInteger() || result.lte(0) || result.gt(2147483647)) throw new Error("The reviewed conversion must produce whole stock units within the supported range.");
  return result.toNumber();
}
export function frozenStockQuantity(quantity: number, conversion: { orderUnit: string | null; stockUnit: string | null; stockPerOrderUnit: Prisma.Decimal | number | string }, orderUnit: string, stockUnit: string) {
  if (normalizeUnit(conversion.orderUnit ?? orderUnit) !== normalizeUnit(orderUnit) || normalizeUnit(conversion.stockUnit ?? orderUnit) !== normalizeUnit(stockUnit)) throw new Error("Units changed since this stock allocation. Review and recreate the draft or reservation.");
  return stockQuantity(quantity, conversion.stockPerOrderUnit);
}
export async function resolveUnitConversion(tx: Prisma.TransactionClient, item: { id: string; uom: string }, orderUnit: string) {
  const from = normalizeUnit(orderUnit), to = normalizeUnit(item.uom);
  if (from === to) return { orderUnit: from, stockUnit: to, stockPerOrderUnit: new Prisma.Decimal(1), conversionId: null };
  const conversion = await tx.inventoryUnitConversion.findFirst({ where: { inventoryItemId: item.id, orderUnit: from, stockUnit: to, status: "Approved" } });
  if (!conversion) throw new Error("Inventory and order units differ. An approved pack/unit conversion for this item is required.");
  return { orderUnit: from, stockUnit: to, stockPerOrderUnit: conversion.stockPerOrderUnit, conversionId: conversion.id };
}
type Context = Pick<AuthContext, "organizationId" | "userId" | "roles" | "permissions">;
export async function reviewUnitConversion(context: Context, itemId: string, input: { action: "propose" | "approve" | "revoke"; id?: string; orderUnit?: string; factor?: number; reason: string }) {
  const permission = input.action === "propose" ? PERMISSIONS.INVENTORY_WRITE : PERMISSIONS.INVENTORY_APPROVE;
  if (!context.organizationId || context.roles.includes("system-agent") || !hasPermission(context, permission)) throw new ApiRequestError("FORBIDDEN", "An authorized inventory reviewer is required.", 403);
  if (!input.reason || input.reason.trim().length < 5 || input.reason.length > 1000) throw new Error("Provide a supporting review reason (5–1000 characters).");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`unit-review:${itemId}`}))`;
    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, organizationId: context.organizationId } });
    if (!item) throw new Error("Inventory item not found in this organization.");
    if (input.action === "propose") {
      const unit = normalizeUnit(input.orderUnit ?? "");
      if (!/^[A-Z0-9][A-Z0-9 /._-]{0,29}$/.test(unit) || unit === normalizeUnit(item.uom)) throw new Error("Enter a different, valid order unit.");
      if (!input.factor || !Number.isFinite(input.factor) || input.factor <= 0 || input.factor > 1000000) throw new Error("Stock units per order unit must be between zero and 1,000,000.");
      const factor = new Prisma.Decimal(input.factor);
      if (!factor.equals(factor.toDecimalPlaces(6))) throw new Error("Use at most six decimal places for the conversion.");
      return tx.inventoryUnitConversion.create({ data: { inventoryItemId: itemId, orderUnit: unit, stockUnit: normalizeUnit(item.uom), stockPerOrderUnit: factor, reason: input.reason.trim(), createdBy: context.userId } });
    }
    const row = await tx.inventoryUnitConversion.findFirst({ where: { id: input.id, inventoryItemId: itemId } });
    if (!row) throw new Error("Conversion not found for this inventory item.");
    if (input.action === "approve") {
      if (row.status !== "Pending" || row.stockUnit !== normalizeUnit(item.uom)) throw new Error("Only a pending conversion matching the current stock unit can be approved.");
      if (await tx.inventoryUnitConversion.count({ where: { inventoryItemId: itemId, orderUnit: row.orderUnit, status: "Approved" } })) throw new Error("Revoke the previous approved conversion before approving its replacement.");
    } else if (row.status === "Revoked") return row;
    return tx.inventoryUnitConversion.update({ where: { id: row.id }, data: { status: input.action === "approve" ? "Approved" : "Revoked", reviewedBy: context.userId, reviewedAt: new Date(), reason: `${row.reason}\n${input.action} by ${context.userId} at ${new Date().toISOString()}: ${input.reason.trim()}` } });
  });
}
