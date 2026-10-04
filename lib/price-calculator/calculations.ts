import type {
  OperationalPriceInput,
  OperationalPriceResult,
  PricingScenarioInput,
  PricingScenarioResult,
  ShippingSpreadLineInput,
  ShippingSpreadLineResult,
  ShippingSpreadMode,
} from "@/types/procurement";

const MONEY_DECIMALS = 2;
const PCT_DECIMALS = 2;

export const DEFAULT_PRICE_INPUT: OperationalPriceInput = {
  supplierUnitCost: 0,
  quantity: 1,
  supplierDiscountPct: 0,
  freightTotal: 0,
  courierCost: 0,
  insurancePct: 0,
  customsDutyPct: 0,
  bondedHandling: 0,
  warehouseHandling: 0,
  packaging: 0,
  portDeliverySurcharge: 0,
  otherFees: 0,
  vatPct: 0,
  currencyAdjustmentPct: 0,
  pricingMode: "markup",
  markupPct: 20,
  targetMarginPct: 20,
  supplierCurrency: "EUR",
  customerCurrency: "EUR",
};

export function roundMoney(value: number): number {
  return roundTo(value, MONEY_DECIMALS);
}

export function roundPercent(value: number): number {
  return roundTo(value, PCT_DECIMALS);
}

export function safeNonNegative(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

export function clampPercent(value: number, max = 100): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), max);
}

export function calculateOperationalPrice(input: OperationalPriceInput): OperationalPriceResult {
  const warnings: string[] = [];
  const supplierUnitCost = safeNonNegative(input.supplierUnitCost);
  const quantity = safeNonNegative(input.quantity);
  const quantityForUnit = quantity > 0 ? quantity : 1;
  const supplierDiscountPct = clampPercent(input.supplierDiscountPct);
  const insurancePct = clampPercent(input.insurancePct, 500);
  const customsDutyPct = clampPercent(input.customsDutyPct, 500);
  const vatPct = clampPercent(input.vatPct, 500);
  const markupPct = clampPercent(input.markupPct, 1000);
  const targetMarginPct = clampPercent(input.targetMarginPct, 99.9);
  const currencyAdjustmentPct = clampPercent(input.currencyAdjustmentPct, 500);

  if (quantity <= 0) warnings.push("Quantity is zero, so unit values use a quantity of 1 for display.");
  if (input.targetMarginPct >= 100) warnings.push("Target margin was capped below 100% to avoid an impossible sell price.");
  if (input.supplierCurrency !== input.customerCurrency && currencyAdjustmentPct === 0) {
    warnings.push("Supplier and customer currencies differ. Add an FX/payment adjustment before quoting.");
  }

  const goodsGross = supplierUnitCost * quantity;
  const supplierDiscountAmount = goodsGross * (supplierDiscountPct / 100);
  const goodsAfterDiscount = goodsGross - supplierDiscountAmount;
  const freightAndDelivery = safeNonNegative(input.freightTotal) + safeNonNegative(input.courierCost);
  const insuranceCost = goodsAfterDiscount * (insurancePct / 100);
  const customsBase = goodsAfterDiscount + freightAndDelivery + insuranceCost;
  const customsDuty = customsBase * (customsDutyPct / 100);
  const handlingAndFees =
    safeNonNegative(input.bondedHandling) +
    safeNonNegative(input.warehouseHandling) +
    safeNonNegative(input.packaging) +
    safeNonNegative(input.portDeliverySurcharge) +
    safeNonNegative(input.otherFees);
  const preAdjustmentCost = goodsAfterDiscount + freightAndDelivery + insuranceCost + customsDuty + handlingAndFees;
  const currencyAdjustment = preAdjustmentCost * (currencyAdjustmentPct / 100);
  const landedTotalCost = preAdjustmentCost + currencyAdjustment;
  const landedUnitCost = landedTotalCost / quantityForUnit;

  const sellUnitPrice = input.pricingMode === "targetMargin"
    ? landedUnitCost / (1 - targetMarginPct / 100)
    : landedUnitCost * (1 + markupPct / 100);
  const sellTotalPrice = sellUnitPrice * quantity;
  const grossProfit = sellTotalPrice - landedTotalCost;
  const grossMarginPct = sellTotalPrice > 0 ? (grossProfit / sellTotalPrice) * 100 : 0;
  const effectiveMarkupPct = landedTotalCost > 0 ? (grossProfit / landedTotalCost) * 100 : 0;
  const vatAmount = sellTotalPrice * (vatPct / 100);
  const grandTotalPrice = sellTotalPrice + vatAmount;

  return {
    goodsGross: roundMoney(goodsGross),
    supplierDiscountAmount: roundMoney(supplierDiscountAmount),
    goodsAfterDiscount: roundMoney(goodsAfterDiscount),
    freightAndDelivery: roundMoney(freightAndDelivery),
    insuranceCost: roundMoney(insuranceCost),
    customsDuty: roundMoney(customsDuty),
    handlingAndFees: roundMoney(handlingAndFees),
    currencyAdjustment: roundMoney(currencyAdjustment),
    vatAmount: roundMoney(vatAmount),
    landedUnitCost: roundMoney(landedUnitCost),
    landedTotalCost: roundMoney(landedTotalCost),
    sellUnitPrice: roundMoney(sellUnitPrice),
    sellTotalPrice: roundMoney(sellTotalPrice),
    grandTotalPrice: roundMoney(grandTotalPrice),
    grossProfit: roundMoney(grossProfit),
    grossMarginPct: roundPercent(grossMarginPct),
    markupPct: roundPercent(markupPct),
    effectiveMarkupPct: roundPercent(effectiveMarkupPct),
    targetMarginPct: roundPercent(targetMarginPct),
    warnings,
  };
}

export function calculateScenarios(baseInput: OperationalPriceInput, scenarios: PricingScenarioInput[]): PricingScenarioResult[] {
  return scenarios.map((scenario) => {
    const result = calculateOperationalPrice({
      ...baseInput,
      pricingMode: scenario.pricingMode,
      markupPct: scenario.markupPct,
      targetMarginPct: scenario.targetMarginPct,
    });

    return {
      ...scenario,
      sellUnitPrice: result.sellUnitPrice,
      sellTotalPrice: result.sellTotalPrice,
      grossProfit: result.grossProfit,
      grossMarginPct: result.grossMarginPct,
      effectiveMarkupPct: result.effectiveMarkupPct,
    };
  });
}

export function calculateShippingSpread(
  lines: ShippingSpreadLineInput[],
  shippingTotal: number,
  mode: ShippingSpreadMode,
): ShippingSpreadLineResult[] {
  const totalShipping = safeNonNegative(shippingTotal);
  const prepared = lines.map((line) => ({
    ...line,
    quantity: safeNonNegative(line.quantity),
    unitCost: safeNonNegative(line.unitCost),
    weight: safeNonNegative(line.weight),
  }));

  const basisTotal = prepared.reduce((sum, line) => sum + spreadBasis(line, mode), 0);
  const fallbackBasis = prepared.length || 1;
  const totalCents = Math.round(totalShipping * 100);
  let cumulativeBasis = 0;
  let allocatedCents = 0;

  return prepared.map((line) => {
    const basis = basisTotal > 0 ? spreadBasis(line, mode) : 1;
    cumulativeBasis += basis;
    const cumulativeCents = Math.round(totalCents * cumulativeBasis / (basisTotal > 0 ? basisTotal : fallbackBasis));
    const allocatedCost = (cumulativeCents - allocatedCents) / 100;
    allocatedCents = cumulativeCents;
    const quantityForUnit = line.quantity > 0 ? line.quantity : 1;
    const allocatedUnitCost = allocatedCost / quantityForUnit;
    const landedUnitCost = line.unitCost + allocatedUnitCost;
    const landedLineCost = line.unitCost * line.quantity + allocatedCost;

    return {
      ...line,
      basis: roundMoney(basis),
      allocatedCost: roundMoney(allocatedCost),
      allocatedUnitCost: roundMoney(allocatedUnitCost),
      landedUnitCost: roundMoney(landedUnitCost),
      landedLineCost: roundMoney(landedLineCost),
    };
  });
}

function spreadBasis(line: ShippingSpreadLineInput, mode: ShippingSpreadMode): number {
  switch (mode) {
    case "value":
      return safeNonNegative(line.quantity) * safeNonNegative(line.unitCost);
    case "weight":
      return safeNonNegative(line.quantity) * safeNonNegative(line.weight);
    case "equal":
      return 1;
    case "quantity":
    default:
      return safeNonNegative(line.quantity);
  }
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
