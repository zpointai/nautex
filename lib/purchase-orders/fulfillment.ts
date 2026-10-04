import type { PurchaseOrderLine } from "@prisma/client";

export type FulfillmentRoute =
  | { key: "internal"; supplier: "Nautex Warehouse"; mode: "internal_stock" }
  | { key: string; supplier: string; mode: "supplier_po" };

export function routeLineForFulfillment(line: Pick<PurchaseOrderLine, "description" | "itemCode">): FulfillmentRoute {
  const text = `${line.itemCode ?? ""} ${line.description}`.toLowerCase();

  if (/copy paper|dividers|post-it|cutter|sellotape|magnetic clip|scissors|file hard cover/.test(text)) {
    return { key: "internal", supplier: "Nautex Warehouse", mode: "internal_stock" };
  }
  if (/brother|p-touch|label|lettertape|tze-|pt-9800/.test(text)) {
    return { key: "brother-office", supplier: "Brother Marine Office Supplies", mode: "supplier_po" };
  }
  if (/3m|dual lock|sj ?355|fasteners/.test(text)) {
    return { key: "3m-marine", supplier: "3M Marine & Safety Products", mode: "supplier_po" };
  }
  if (/calculator|keyboard|wireless|usb/.test(text)) {
    return { key: "office-equipment", supplier: "Marine Office Equipment Supply", mode: "supplier_po" };
  }

  return { key: "general-marine", supplier: "General Marine Chandlery Supply", mode: "supplier_po" };
}

export function supplierCostFromBuyerPrice(unitPrice: number) {
  return Math.max(0, Math.round(unitPrice * 0.86 * 100) / 100);
}
