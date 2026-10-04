import { NextResponse } from "next/server";
import {
  calculateOperationalPrice,
  calculateScenarios,
  calculateShippingSpread,
  DEFAULT_PRICE_INPUT,
  safeNonNegative,
} from "@/lib/price-calculator/calculations";
import type {
  OperationalPriceInput,
  PricingMode,
  PricingScenarioInput,
  ShippingSpreadLineInput,
  ShippingSpreadMode,
} from "@/types/procurement";

type PriceCalculationRequest = {
  input?: Partial<OperationalPriceInput>;
  scenarios?: Array<Partial<PricingScenarioInput>>;
  shipping?: {
    mode?: ShippingSpreadMode;
    total?: number;
    lines?: Array<Partial<ShippingSpreadLineInput>>;
  };
};

const PRICING_MODES = new Set<PricingMode>(["markup", "targetMargin"]);
const SHIPPING_MODES = new Set<ShippingSpreadMode>(["quantity", "value", "weight", "equal"]);
const CURRENCIES = new Set(["EUR", "USD", "GBP", "SGD", "AED"]);

export async function POST(req: Request) {
  try {
    const body = await req.json() as PriceCalculationRequest;
    const input = normalizeInput(body.input || {});
    const scenarios = normalizeScenarios(body.scenarios || []);
    const shipping = normalizeShipping(body.shipping);

    const result = calculateOperationalPrice(input);
    const scenarioResults = calculateScenarios(input, scenarios);
    const shippingResults = calculateShippingSpread(shipping.lines, shipping.total, shipping.mode);

    return NextResponse.json({
      ok: true,
      data: {
        result,
        scenarios: scenarioResults,
        shipping: {
          mode: shipping.mode,
          total: shipping.total,
          lines: shippingResults,
        },
        auditMetadata: {
          deterministic: true,
          aiAssisted: false,
          schemaVersion: "price-calculator.v1",
          generatedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error("[api] POST /api/v1/price-calculator/calculate:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: { message: "Failed to calculate price." } }, { status: 400 });
  }
}

function normalizeInput(input: Partial<OperationalPriceInput>): OperationalPriceInput {
  return {
    ...DEFAULT_PRICE_INPUT,
    supplierUnitCost: number(input.supplierUnitCost),
    quantity: number(input.quantity, DEFAULT_PRICE_INPUT.quantity),
    supplierDiscountPct: number(input.supplierDiscountPct),
    freightTotal: number(input.freightTotal),
    courierCost: number(input.courierCost),
    insurancePct: number(input.insurancePct),
    customsDutyPct: number(input.customsDutyPct),
    bondedHandling: number(input.bondedHandling),
    warehouseHandling: number(input.warehouseHandling),
    packaging: number(input.packaging),
    portDeliverySurcharge: number(input.portDeliverySurcharge),
    otherFees: number(input.otherFees),
    vatPct: number(input.vatPct),
    currencyAdjustmentPct: number(input.currencyAdjustmentPct),
    pricingMode: typeof input.pricingMode === "string" && PRICING_MODES.has(input.pricingMode) ? input.pricingMode : DEFAULT_PRICE_INPUT.pricingMode,
    markupPct: number(input.markupPct, DEFAULT_PRICE_INPUT.markupPct),
    targetMarginPct: number(input.targetMarginPct, DEFAULT_PRICE_INPUT.targetMarginPct),
    supplierCurrency: currency(input.supplierCurrency, DEFAULT_PRICE_INPUT.supplierCurrency),
    customerCurrency: currency(input.customerCurrency, DEFAULT_PRICE_INPUT.customerCurrency),
  };
}

function normalizeScenarios(scenarios: Array<Partial<PricingScenarioInput>>): PricingScenarioInput[] {
  return scenarios.slice(0, 6).map((scenario, index) => ({
    id: text(scenario.id, `scenario-${index + 1}`),
    label: text(scenario.label, `Scenario ${index + 1}`),
    pricingMode: typeof scenario.pricingMode === "string" && PRICING_MODES.has(scenario.pricingMode) ? scenario.pricingMode : DEFAULT_PRICE_INPUT.pricingMode,
    markupPct: number(scenario.markupPct, DEFAULT_PRICE_INPUT.markupPct),
    targetMarginPct: number(scenario.targetMarginPct, DEFAULT_PRICE_INPUT.targetMarginPct),
  }));
}

function normalizeShipping(shipping: PriceCalculationRequest["shipping"]) {
  const mode = shipping?.mode && SHIPPING_MODES.has(shipping.mode) ? shipping.mode : "quantity";
  const lines = (shipping?.lines || []).slice(0, 50).map((line, index) => ({
    id: text(line.id, `line-${index + 1}`),
    label: text(line.label, `Line ${index + 1}`),
    quantity: number(line.quantity),
    unitCost: number(line.unitCost),
    weight: number(line.weight),
  }));

  return {
    mode,
    total: number(shipping?.total),
    lines,
  };
}

function number(value: unknown, fallback = 0) {
  return safeNonNegative(typeof value === "number" ? value : Number(value), fallback);
}

function text(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : fallback;
}

function currency(value: unknown, fallback: string) {
  return typeof value === "string" && CURRENCIES.has(value) ? value : fallback;
}
