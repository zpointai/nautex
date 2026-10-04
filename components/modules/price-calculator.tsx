"use client";

import { useMemo, useState } from "react";
import {
  calculateOperationalPrice,
  calculateScenarios,
  calculateShippingSpread,
  DEFAULT_PRICE_INPUT,
} from "@/lib/price-calculator/calculations";
import type {
  OperationalPriceInput,
  OperationalPriceResult,
  PricingMode,
  PricingScenarioInput,
  ShippingSpreadLineInput,
  ShippingSpreadMode,
} from "@/types/procurement";

type CalculatorTab = "landed" | "markup" | "shipping" | "scenarios";

type PriceDraft = {
  supplierUnitCost: string;
  quantity: string;
  supplierDiscountPct: string;
  freightTotal: string;
  courierCost: string;
  insurancePct: string;
  customsDutyPct: string;
  bondedHandling: string;
  warehouseHandling: string;
  packaging: string;
  portDeliverySurcharge: string;
  otherFees: string;
  vatPct: string;
  currencyAdjustmentPct: string;
  pricingMode: PricingMode;
  markupPct: string;
  targetMarginPct: string;
  supplierCurrency: string;
  customerCurrency: string;
};

type ServerCheckState =
  | { status: "idle"; message: string; signature: string | null }
  | { status: "checking"; message: string; signature: string | null }
  | { status: "verified"; message: string; signature: string }
  | { status: "mismatch"; message: string; signature: string }
  | { status: "error"; message: string; signature: string | null };

type PriceCalculatorApiResponse = {
  ok: boolean;
  data?: {
    result: OperationalPriceResult;
    auditMetadata: {
      deterministic: boolean;
      aiAssisted: boolean;
      schemaVersion: string;
      generatedAt: string;
    };
  };
  error?: { message?: string };
};

const CURRENCIES = ["EUR", "USD", "GBP", "SGD", "AED"] as const;
const TABS: Array<{ key: CalculatorTab; label: string; icon: string }> = [
  { key: "landed", label: "Landed Cost & Margin", icon: "layers" },
  { key: "markup", label: "Simple Markup", icon: "percent" },
  { key: "shipping", label: "Shipping Spread", icon: "local_shipping" },
  { key: "scenarios", label: "Scenario Comparison", icon: "compare_arrows" },
];

const DEFAULT_DRAFT: PriceDraft = {
  supplierUnitCost: "",
  quantity: "1",
  supplierDiscountPct: "",
  freightTotal: "",
  courierCost: "",
  insurancePct: "",
  customsDutyPct: "",
  bondedHandling: "",
  warehouseHandling: "",
  packaging: "",
  portDeliverySurcharge: "",
  otherFees: "",
  vatPct: "",
  currencyAdjustmentPct: "",
  pricingMode: "markup",
  markupPct: "20",
  targetMarginPct: "20",
  supplierCurrency: "EUR",
  customerCurrency: "EUR",
};

const DEFAULT_SCENARIOS: PricingScenarioInput[] = [
  { id: "conservative", label: "Conservative", pricingMode: "targetMargin", markupPct: 18, targetMarginPct: 16 },
  { id: "standard", label: "Standard", pricingMode: "markup", markupPct: 22, targetMarginPct: 18 },
  { id: "aggressive", label: "Aggressive", pricingMode: "markup", markupPct: 30, targetMarginPct: 23 },
];

const DEFAULT_SPREAD_LINES: ShippingSpreadLineInput[] = [
  { id: "line-1", label: "RFQ line 1", quantity: 12, unitCost: 18.5, weight: 2 },
  { id: "line-2", label: "RFQ line 2", quantity: 4, unitCost: 86, weight: 8 },
  { id: "line-3", label: "RFQ line 3", quantity: 1, unitCost: 220, weight: 18 },
];

const MONEY_FORMATTERS = new Map<string, Intl.NumberFormat>();
const NUMERIC_PATTERN = /^\d*\.?\d*$/;

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>
      {name}
    </span>
  );
}

function money(value: number, currency: string) {
  const key = currency || "EUR";
  let formatter = MONEY_FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: key, minimumFractionDigits: 2 });
    MONEY_FORMATTERS.set(key, formatter);
  }
  return formatter.format(Number.isFinite(value) ? value : 0);
}

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDraftInput(draft: PriceDraft): OperationalPriceInput {
  return {
    ...DEFAULT_PRICE_INPUT,
    supplierUnitCost: parseNumber(draft.supplierUnitCost),
    quantity: parseNumber(draft.quantity),
    supplierDiscountPct: parseNumber(draft.supplierDiscountPct),
    freightTotal: parseNumber(draft.freightTotal),
    courierCost: parseNumber(draft.courierCost),
    insurancePct: parseNumber(draft.insurancePct),
    customsDutyPct: parseNumber(draft.customsDutyPct),
    bondedHandling: parseNumber(draft.bondedHandling),
    warehouseHandling: parseNumber(draft.warehouseHandling),
    packaging: parseNumber(draft.packaging),
    portDeliverySurcharge: parseNumber(draft.portDeliverySurcharge),
    otherFees: parseNumber(draft.otherFees),
    vatPct: parseNumber(draft.vatPct),
    currencyAdjustmentPct: parseNumber(draft.currencyAdjustmentPct),
    pricingMode: draft.pricingMode,
    markupPct: parseNumber(draft.markupPct),
    targetMarginPct: parseNumber(draft.targetMarginPct),
    supplierCurrency: draft.supplierCurrency,
    customerCurrency: draft.customerCurrency,
  };
}

function setNumericValue(value: string, onChange: (value: string) => void) {
  if (NUMERIC_PATTERN.test(value)) onChange(value);
}

function buildSummary(input: OperationalPriceInput, result: ReturnType<typeof calculateOperationalPrice>) {
  const currency = input.customerCurrency;
  return [
    `Nautex pricing calculation (${currency})`,
    `Supplier cost: ${money(input.supplierUnitCost, input.supplierCurrency)} x ${input.quantity || 0}`,
    `Goods after discount: ${money(result.goodsAfterDiscount, currency)}`,
    `Freight/delivery: ${money(result.freightAndDelivery, currency)}; insurance: ${money(result.insuranceCost, currency)}; customs: ${money(result.customsDuty, currency)}; fees: ${money(result.handlingAndFees, currency)}`,
    `Landed total: ${money(result.landedTotalCost, currency)}; landed unit: ${money(result.landedUnitCost, currency)}`,
    `Sell unit: ${money(result.sellUnitPrice, currency)}; sell total: ${money(result.sellTotalPrice, currency)}`,
    `Gross profit: ${money(result.grossProfit, currency)}; margin: ${result.grossMarginPct.toFixed(1)}%; markup: ${result.effectiveMarkupPct.toFixed(1)}%`,
    result.vatAmount > 0 ? `VAT/tax: ${money(result.vatAmount, currency)}; customer total: ${money(result.grandTotalPrice, currency)}` : "",
  ].filter(Boolean).join("\n");
}

function verificationSignature(
  input: OperationalPriceInput,
  scenarios: PricingScenarioInput[],
  spreadLines: ShippingSpreadLineInput[],
  spreadMode: ShippingSpreadMode,
  spreadTotal: string,
) {
  return JSON.stringify({ input, scenarios, spreadLines, spreadMode, spreadTotal });
}

function sameOperationalResult(left: OperationalPriceResult, right: OperationalPriceResult) {
  const keys: Array<keyof OperationalPriceResult> = [
    "goodsGross",
    "supplierDiscountAmount",
    "goodsAfterDiscount",
    "freightAndDelivery",
    "insuranceCost",
    "customsDuty",
    "handlingAndFees",
    "currencyAdjustment",
    "vatAmount",
    "landedUnitCost",
    "landedTotalCost",
    "sellUnitPrice",
    "sellTotalPrice",
    "grandTotalPrice",
    "grossProfit",
    "grossMarginPct",
    "effectiveMarkupPct",
    "targetMarginPct",
  ];

  return keys.every((key) => left[key] === right[key]);
}

function InputField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-wider text-on-surface-variant">{props.label}</span>
      <span className="relative block">
        {props.prefix ? <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">{props.prefix}</span> : null}
        <input
          type="text"
          inputMode="decimal"
          value={props.value}
          onChange={(event) => setNumericValue(event.target.value, props.onChange)}
          placeholder={props.placeholder || "0"}
          className={`w-full rounded-lg border border-outline-variant/30 bg-surface-lowest py-2.5 text-sm text-on-surface outline-none transition focus:border-success/50 focus:ring-1 focus:ring-success/40 ${props.prefix ? "pl-10" : "pl-3"} ${props.suffix ? "pr-9" : "pr-3"}`}
        />
        {props.suffix ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant">{props.suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectField(props: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.62rem] font-bold uppercase tracking-wider text-on-surface-variant">{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-lg border border-outline-variant/30 bg-surface-lowest px-3 py-2.5 text-sm text-on-surface outline-none focus:border-success/50 focus:ring-1 focus:ring-success/40"
      >
        {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "accent" | "success" | "danger" }) {
  const toneClass = tone === "accent" ? "text-success" : tone === "success" ? "text-success" : tone === "danger" ? "text-error" : "text-on-surface";
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-lowest/70 p-3">
      <p className="text-[0.62rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function ResultRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-1.5 ${strong ? "border-t border-outline-variant/30 pt-3 text-on-surface" : "text-secondary"}`}>
      <span className={strong ? "text-sm font-semibold" : "text-sm"}>{label}</span>
      <span className={`shrink-0 font-mono ${strong ? "text-base font-semibold text-on-surface" : "text-sm text-on-surface"}`}>{value}</span>
    </div>
  );
}

export function PriceCalculatorModule() {
  const [activeTab, setActiveTab] = useState<CalculatorTab>("landed");
  const [draft, setDraft] = useState<PriceDraft>(DEFAULT_DRAFT);
  const [copied, setCopied] = useState(false);
  const [simplePrice, setSimplePrice] = useState("");
  const [simpleMarkup, setSimpleMarkup] = useState("16.5");
  const [simpleCurrency, setSimpleCurrency] = useState("EUR");
  const [spreadMode, setSpreadMode] = useState<ShippingSpreadMode>("quantity");
  const [spreadTotal, setSpreadTotal] = useState("240");
  const [spreadLines, setSpreadLines] = useState<ShippingSpreadLineInput[]>(DEFAULT_SPREAD_LINES);
  const [scenarios, setScenarios] = useState<PricingScenarioInput[]>(DEFAULT_SCENARIOS);
  const [serverCheck, setServerCheck] = useState<ServerCheckState>({ status: "idle", message: "Server verification not run", signature: null });

  const input = useMemo(() => toDraftInput(draft), [draft]);
  const result = useMemo(() => calculateOperationalPrice(input), [input]);
  const scenarioResults = useMemo(() => calculateScenarios(input, scenarios), [input, scenarios]);
  const spreadResults = useMemo(() => calculateShippingSpread(spreadLines, parseNumber(spreadTotal), spreadMode), [spreadLines, spreadTotal, spreadMode]);
  const hasOperationalInput = input.supplierUnitCost > 0;
  const simpleBase = parseNumber(simplePrice);
  const simpleMarkupPct = parseNumber(simpleMarkup);
  const simpleMarkupAmount = simpleBase * (simpleMarkupPct / 100);
  const simpleTotal = simpleBase + simpleMarkupAmount;
  const currentSignature = useMemo(
    () => verificationSignature(input, scenarios, spreadLines, spreadMode, spreadTotal),
    [input, scenarios, spreadLines, spreadMode, spreadTotal],
  );
  const serverCheckIsCurrent = serverCheck.signature === currentSignature;

  const updateDraft = (key: keyof PriceDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(buildSummary(input, result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const verifyOnServer = async () => {
    const signature = currentSignature;
    setServerCheck({ status: "checking", message: "Checking backend calculation", signature });

    try {
      const response = await fetch("/api/v1/price-calculator/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          scenarios,
          shipping: {
            mode: spreadMode,
            total: parseNumber(spreadTotal),
            lines: spreadLines,
          },
        }),
      });
      const payload = await response.json() as PriceCalculatorApiResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        setServerCheck({ status: "error", message: payload.error?.message || "Backend calculation failed", signature });
        return;
      }

      setServerCheck(
        sameOperationalResult(result, payload.data.result)
          ? { status: "verified", message: `Server verified (${payload.data.auditMetadata.schemaVersion})`, signature }
          : { status: "mismatch", message: "Backend result differs from live calculation", signature },
      );
    } catch {
      setServerCheck({ status: "error", message: "Backend verification unavailable", signature });
    }
  };

  return (
    <div className="max-w-none space-y-5">
      <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="calculate" className="text-lg text-success" />
              <h3 className="text-sm font-bold text-on-surface">Operational Price Calculator</h3>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">
              Deterministic landed-cost, markup, margin, and freight spread calculations for ship chandler quoting workflows.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <StatusPill icon="bolt" label="RFQ-ready" />
            <StatusPill icon="handshake" label="Agreement context" />
            <StatusPill icon="inventory_2" label="Stock costing" />
            <StatusPill icon="account_balance_wallet" label="Margin control" />
          </div>
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition ${
                activeTab === tab.key
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-outline-variant/20 bg-surface-lowest/40 text-secondary hover:bg-surface-high"
              }`}
            >
              <Icon name={tab.icon} className="text-base" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === "landed" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
          <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
            <SectionTitle icon="request_quote" title="Cost Inputs" detail="Build landed cost from supplier cost, logistics, duty, handling, and tax." />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <SelectField label="Supplier currency" value={draft.supplierCurrency} options={CURRENCIES} onChange={(value) => updateDraft("supplierCurrency", value)} />
              <SelectField label="Customer currency" value={draft.customerCurrency} options={CURRENCIES} onChange={(value) => updateDraft("customerCurrency", value)} />
              <InputField label="FX/payment adjustment" value={draft.currencyAdjustmentPct} onChange={(value) => updateDraft("currencyAdjustmentPct", value)} suffix="%" />
              <InputField label="Supplier unit cost" value={draft.supplierUnitCost} onChange={(value) => updateDraft("supplierUnitCost", value)} prefix={draft.supplierCurrency} placeholder="0.00" />
              <InputField label="Quantity" value={draft.quantity} onChange={(value) => updateDraft("quantity", value)} />
              <InputField label="Supplier discount" value={draft.supplierDiscountPct} onChange={(value) => updateDraft("supplierDiscountPct", value)} suffix="%" />
              <InputField label="Freight total" value={draft.freightTotal} onChange={(value) => updateDraft("freightTotal", value)} prefix={draft.customerCurrency} />
              <InputField label="Courier / urgent delivery" value={draft.courierCost} onChange={(value) => updateDraft("courierCost", value)} prefix={draft.customerCurrency} />
              <InputField label="Insurance" value={draft.insurancePct} onChange={(value) => updateDraft("insurancePct", value)} suffix="%" />
              <InputField label="Customs duty" value={draft.customsDutyPct} onChange={(value) => updateDraft("customsDutyPct", value)} suffix="%" />
              <InputField label="Bonded handling" value={draft.bondedHandling} onChange={(value) => updateDraft("bondedHandling", value)} prefix={draft.customerCurrency} />
              <InputField label="Warehouse handling" value={draft.warehouseHandling} onChange={(value) => updateDraft("warehouseHandling", value)} prefix={draft.customerCurrency} />
              <InputField label="Packaging" value={draft.packaging} onChange={(value) => updateDraft("packaging", value)} prefix={draft.customerCurrency} />
              <InputField label="Port delivery surcharge" value={draft.portDeliverySurcharge} onChange={(value) => updateDraft("portDeliverySurcharge", value)} prefix={draft.customerCurrency} />
              <InputField label="Other fees" value={draft.otherFees} onChange={(value) => updateDraft("otherFees", value)} prefix={draft.customerCurrency} />
              <InputField label="VAT / sales tax" value={draft.vatPct} onChange={(value) => updateDraft("vatPct", value)} suffix="%" />
            </div>

            <div className="mt-5 rounded-lg border border-outline-variant/20 bg-surface-lowest/45 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[0.62rem] font-bold uppercase tracking-wider text-on-surface-variant">Pricing mode</p>
                  <div className="mt-2 flex rounded-lg border border-outline-variant/30 bg-surface-lowest p-1">
                    <ModeButton active={draft.pricingMode === "markup"} label="Markup" onClick={() => updateDraft("pricingMode", "markup")} />
                    <ModeButton active={draft.pricingMode === "targetMargin"} label="Target margin" onClick={() => updateDraft("pricingMode", "targetMargin")} />
                  </div>
                </div>
                <div className="grid flex-1 gap-3 md:grid-cols-2">
                  <InputField label="Markup on landed cost" value={draft.markupPct} onChange={(value) => updateDraft("markupPct", value)} suffix="%" />
                  <InputField label="Target gross margin" value={draft.targetMarginPct} onChange={(value) => updateDraft("targetMarginPct", value)} suffix="%" />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
            <div className="flex items-start justify-between gap-4">
              <SectionTitle icon="monitoring" title="Calculation Result" detail="Shown separately so VAT does not inflate margin." />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={verifyOnServer}
                  disabled={!hasOperationalInput || serverCheck.status === "checking"}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-lowest/70 px-3 py-2 text-xs font-bold text-secondary transition hover:text-on-surface disabled:opacity-40"
                >
                  <Icon name={serverCheck.status === "checking" ? "sync" : "verified"} className="text-base" />
                  {serverCheck.status === "checking" ? "Checking" : "Verify"}
                </button>
                <button
                  onClick={copyResult}
                  disabled={!hasOperationalInput}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-lowest/70 px-3 py-2 text-xs font-bold text-secondary transition hover:text-on-surface disabled:opacity-40"
                >
                  <Icon name={copied ? "check" : "content_copy"} className="text-base" />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="Landed unit cost" value={hasOperationalInput ? money(result.landedUnitCost, input.customerCurrency) : "--"} />
              <Metric label="Sell unit price" value={hasOperationalInput ? money(result.sellUnitPrice, input.customerCurrency) : "--"} tone="accent" />
              <Metric label="Gross profit" value={hasOperationalInput ? money(result.grossProfit, input.customerCurrency) : "--"} tone={result.grossProfit >= 0 ? "success" : "danger"} />
              <Metric label="Gross margin" value={hasOperationalInput ? `${result.grossMarginPct.toFixed(1)}%` : "--"} />
            </div>

            <div className="mt-5 space-y-1">
              <ResultRow label="Goods before discount" value={hasOperationalInput ? money(result.goodsGross, input.customerCurrency) : "--"} />
              <ResultRow label="Supplier discount" value={hasOperationalInput ? `- ${money(result.supplierDiscountAmount, input.customerCurrency)}` : "--"} />
              <ResultRow label="Goods after discount" value={hasOperationalInput ? money(result.goodsAfterDiscount, input.customerCurrency) : "--"} />
              <ResultRow label="Freight and delivery" value={hasOperationalInput ? money(result.freightAndDelivery, input.customerCurrency) : "--"} />
              <ResultRow label="Insurance cost" value={hasOperationalInput ? money(result.insuranceCost, input.customerCurrency) : "--"} />
              <ResultRow label="Customs duty" value={hasOperationalInput ? money(result.customsDuty, input.customerCurrency) : "--"} />
              <ResultRow label="Handling and other fees" value={hasOperationalInput ? money(result.handlingAndFees, input.customerCurrency) : "--"} />
              <ResultRow label="FX/payment adjustment" value={hasOperationalInput ? money(result.currencyAdjustment, input.customerCurrency) : "--"} />
              <ResultRow label="Landed total cost" value={hasOperationalInput ? money(result.landedTotalCost, input.customerCurrency) : "--"} strong />
              <ResultRow label="Sell total before VAT" value={hasOperationalInput ? money(result.sellTotalPrice, input.customerCurrency) : "--"} />
              <ResultRow label="VAT / sales tax" value={hasOperationalInput ? money(result.vatAmount, input.customerCurrency) : "--"} />
              <ResultRow label="Customer total incl. tax" value={hasOperationalInput ? money(result.grandTotalPrice, input.customerCurrency) : "--"} strong />
            </div>

            {result.warnings.length > 0 ? (
              <div className="mt-5 space-y-2 rounded-lg border border-warning/20 bg-warning/8 p-3">
                {result.warnings.map((warning) => (
                  <div key={warning} className="flex gap-2 text-xs text-warning">
                    <Icon name="warning" className="text-sm" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className={`mt-5 flex items-start gap-2 rounded-lg border p-3 text-xs ${
              !serverCheckIsCurrent && serverCheck.status !== "idle"
                ? "border-warning/20 bg-warning/8 text-warning"
                : serverCheck.status === "verified"
                  ? "border-success/20 bg-success/8 text-success"
                  : serverCheck.status === "mismatch" || serverCheck.status === "error"
                    ? "border-error/20 bg-error/8 text-error"
                    : "border-outline-variant/20 bg-surface-lowest/45 text-on-surface-variant"
            }`}>
              <Icon
                name={!serverCheckIsCurrent && serverCheck.status !== "idle" ? "history" : serverCheck.status === "verified" ? "verified" : serverCheck.status === "mismatch" || serverCheck.status === "error" ? "error" : "dns"}
                className="text-sm"
              />
              <span>{!serverCheckIsCurrent && serverCheck.status !== "idle" ? "Inputs changed since backend verification" : serverCheck.message}</span>
            </div>

            <div className="mt-5 rounded-lg border border-outline-variant/20 bg-surface-lowest/45 p-3 text-xs leading-5 text-on-surface-variant">
              Formula: goods after discount + freight/courier + insurance + customs + handling/fees + FX adjustment = landed cost. Sell price is then calculated from markup on landed cost or target gross margin.
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "markup" ? (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
            <SectionTitle icon="percent" title="Simple Markup" detail="Fast check for known landed or supplier cost." />
            <div className="mt-5 space-y-4">
              <SelectField label="Currency" value={simpleCurrency} options={CURRENCIES} onChange={setSimpleCurrency} />
              <InputField label="Base / landed price" value={simplePrice} onChange={setSimplePrice} prefix={simpleCurrency} placeholder="0.00" />
              <InputField label="Markup percentage" value={simpleMarkup} onChange={setSimpleMarkup} suffix="%" />
              <div className="flex flex-wrap gap-2">
                {[10, 15, 16.5, 20, 25, 30, 35, 50].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setSimpleMarkup(String(preset))}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition ${simpleMarkup === String(preset) ? "bg-success text-on-primary" : "bg-surface-lowest text-secondary hover:bg-surface-high"}`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
            <SectionTitle icon="receipt_long" title="Markup Result" detail="Use landed cost here when logistics and tax are already known." />
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Base price" value={simplePrice ? money(simpleBase, simpleCurrency) : "--"} />
              <Metric label="Markup amount" value={simplePrice ? money(simpleMarkupAmount, simpleCurrency) : "--"} />
              <Metric label="Sell price" value={simplePrice ? money(simpleTotal, simpleCurrency) : "--"} tone="accent" />
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "shipping" ? (
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <SectionTitle icon="local_shipping" title="Shipping / Cost Spread" detail="Allocate freight or urgent delivery cost across item lines before final pricing." />
            <div className="grid gap-3 sm:grid-cols-[180px_220px]">
              <InputField label="Total freight to allocate" value={spreadTotal} onChange={setSpreadTotal} prefix={input.customerCurrency} />
              <SelectField label="Spread basis" value={spreadMode} options={["quantity", "value", "weight", "equal"]} onChange={(value) => setSpreadMode(value as ShippingSpreadMode)} />
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-outline-variant/30 text-[0.62rem] uppercase tracking-wider text-on-surface-variant">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit cost</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">Allocated freight</th>
                  <th className="px-3 py-2 text-right">Freight / unit</th>
                  <th className="px-3 py-2 text-right">Landed unit</th>
                  <th className="px-3 py-2 text-right">Line landed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {spreadResults.map((line, index) => (
                  <tr key={line.id}>
                    <td className="px-3 py-3">
                      <input
                        value={line.label}
                        onChange={(event) => updateSpreadLine(index, "label", event.target.value, setSpreadLines)}
                        className="w-full rounded-md border border-outline-variant/30 bg-surface-lowest px-2 py-1.5 text-xs text-on-surface outline-none focus:border-success/50"
                      />
                    </td>
                    <SpreadCell value={String(line.quantity || "")} onChange={(value) => updateSpreadLine(index, "quantity", parseNumber(value), setSpreadLines)} />
                    <SpreadCell value={String(line.unitCost || "")} onChange={(value) => updateSpreadLine(index, "unitCost", parseNumber(value), setSpreadLines)} />
                    <SpreadCell value={String(line.weight || "")} onChange={(value) => updateSpreadLine(index, "weight", parseNumber(value), setSpreadLines)} />
                    <td className="px-3 py-3 text-right font-mono text-on-surface">{money(line.allocatedCost, input.customerCurrency)}</td>
                    <td className="px-3 py-3 text-right font-mono text-on-surface">{money(line.allocatedUnitCost, input.customerCurrency)}</td>
                    <td className="px-3 py-3 text-right font-mono text-success">{money(line.landedUnitCost, input.customerCurrency)}</td>
                    <td className="px-3 py-3 text-right font-mono text-on-surface">{money(line.landedLineCost, input.customerCurrency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "scenarios" ? (
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-5">
          <SectionTitle icon="compare_arrows" title="Scenario Comparison" detail="Compare pricing posture against the same landed-cost base." />
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {scenarioResults.map((scenario, index) => (
              <div key={scenario.id} className="rounded-xl border border-outline-variant/20 bg-surface-lowest/55 p-4">
                <input
                  value={scenario.label}
                  onChange={(event) => updateScenario(index, { label: event.target.value }, setScenarios)}
                  className="w-full rounded-md border border-outline-variant/30 bg-surface-lowest px-2 py-1.5 text-sm font-bold text-on-surface outline-none focus:border-success/50"
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => updateScenario(index, { pricingMode: "markup" }, setScenarios)}
                    className={`rounded-md px-2 py-1.5 text-xs font-bold ${scenario.pricingMode === "markup" ? "bg-success/15 text-success" : "bg-surface-container text-on-surface-variant"}`}
                  >
                    Markup
                  </button>
                  <button
                    onClick={() => updateScenario(index, { pricingMode: "targetMargin" }, setScenarios)}
                    className={`rounded-md px-2 py-1.5 text-xs font-bold ${scenario.pricingMode === "targetMargin" ? "bg-success/15 text-success" : "bg-surface-container text-on-surface-variant"}`}
                  >
                    Margin
                  </button>
                  <InputField label="Markup" value={String(scenario.markupPct)} onChange={(value) => updateScenario(index, { markupPct: parseNumber(value) }, setScenarios)} suffix="%" />
                  <InputField label="Target margin" value={String(scenario.targetMarginPct)} onChange={(value) => updateScenario(index, { targetMarginPct: parseNumber(value) }, setScenarios)} suffix="%" />
                </div>
                <div className="mt-4 space-y-1">
                  <ResultRow label="Sell unit" value={hasOperationalInput ? money(scenario.sellUnitPrice, input.customerCurrency) : "--"} />
                  <ResultRow label="Sell total" value={hasOperationalInput ? money(scenario.sellTotalPrice, input.customerCurrency) : "--"} />
                  <ResultRow label="Gross profit" value={hasOperationalInput ? money(scenario.grossProfit, input.customerCurrency) : "--"} />
                  <ResultRow label="Margin" value={hasOperationalInput ? `${scenario.grossMarginPct.toFixed(1)}%` : "--"} strong />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SectionTitle({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon name={icon} className="text-lg text-success" />
        <h4 className="text-sm font-bold text-on-surface">{title}</h4>
      </div>
      <p className="mt-1 text-sm text-on-surface-variant">{detail}</p>
    </div>
  );
}

function StatusPill({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/20 bg-surface-lowest/55 px-2.5 py-2 text-on-surface-variant">
      <Icon name={icon} className="text-sm" />
      <span>{label}</span>
    </span>
  );
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${active ? "bg-success/15 text-success" : "text-on-surface-variant hover:text-on-surface"}`}
    >
      {label}
    </button>
  );
}

function SpreadCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <td className="px-3 py-3">
      <input
        value={value}
        onChange={(event) => setNumericValue(event.target.value, onChange)}
        className="ml-auto block w-24 rounded-md border border-outline-variant/30 bg-surface-lowest px-2 py-1.5 text-right font-mono text-xs text-on-surface outline-none focus:border-success/50"
      />
    </td>
  );
}

function updateSpreadLine(
  index: number,
  key: keyof ShippingSpreadLineInput,
  value: string | number,
  setSpreadLines: React.Dispatch<React.SetStateAction<ShippingSpreadLineInput[]>>,
) {
  setSpreadLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
}

function updateScenario(
  index: number,
  patch: Partial<PricingScenarioInput>,
  setScenarios: React.Dispatch<React.SetStateAction<PricingScenarioInput[]>>,
) {
  setScenarios((current) => current.map((scenario, scenarioIndex) => scenarioIndex === index ? { ...scenario, ...patch } : scenario));
}
