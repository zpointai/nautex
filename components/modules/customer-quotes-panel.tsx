"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RfqSummary = {
  id: string;
  vessel: string;
  port: string;
  status: string;
  lines: Array<{ id: string }>;
};

type CustomerSummary = {
  id: string;
  customerCode: string;
  name: string;
  defaultCurrency: string;
};

type CustomerQuote = {
  id: string;
  quoteNumber: string | null;
  customer: string;
  vessel: string | null;
  port: string | null;
  status: "Draft" | "PendingApproval" | "Approved" | "Sent" | "Accepted" | "Declined" | "Expired" | "Cancelled";
  currency: string;
  validUntil: string;
  marginPct: number;
  netAmount: number;
  grossAmount: number;
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    sourceSupplier: string | null;
  }>;
};

type SalesOrder = {
  id: string;
  salesOrderNumber: string | null;
  quoteId: string;
  quoteNumber: string | null;
  customer: string;
  fulfillmentOrderId: string;
  fulfillmentOrderNumber: string;
  status: "Confirmed" | "InFulfillment" | "PartiallyDelivered" | "Delivered" | "Cancelled";
  vessel: string | null;
  port: string | null;
  requestedDeliveryAt: string;
  currency: string;
  netAmount: number;
  marginPct: number;
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: number;
    deliveredQuantity: number;
    unit: string;
    status: "Open" | "PartiallyDelivered" | "Delivered" | "Cancelled";
  }>;
};

function Icon({ name }: { name: string }) {
  return <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 0" }}>{name}</span>;
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function CustomerQuotesPanel() {
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [quotes, setQuotes] = useState<CustomerQuote[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [rfqId, setRfqId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [markupPct, setMarkupPct] = useState("20");
  const [vatRate, setVatRate] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const responses = await Promise.all([
        fetch("/api/v1/rfqs"),
        fetch("/api/v1/customer-accounts"),
        fetch("/api/v1/customer-quotes"),
        fetch("/api/v1/sales-orders"),
      ]);
      const payloads = await Promise.all(responses.map((response) => response.json()));
      const failedIndex = responses.findIndex((response, index) => !response.ok || payloads[index]?.ok === false);
      if (failedIndex >= 0) throw new Error(payloads[failedIndex]?.error?.message ?? "Customer quote data could not be loaded.");
      setRfqs(Array.isArray(payloads[0].data) ? payloads[0].data : []);
      setCustomers(Array.isArray(payloads[1].data) ? payloads[1].data : []);
      setQuotes(Array.isArray(payloads[2].data) ? payloads[2].data : []);
      setSalesOrders(Array.isArray(payloads[3].data) ? payloads[3].data : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer quote data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!rfqId && rfqs[0]) setRfqId(rfqs[0].id); }, [rfqId, rfqs]);
  useEffect(() => { if (!customerId && customers[0]) setCustomerId(customers[0].id); }, [customerId, customers]);
  const salesOrderByQuote = useMemo(() => new Map(salesOrders.map((order) => [order.quoteId, order])), [salesOrders]);

  const post = useCallback(async (url: string, body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Customer quote action failed.");
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer quote action failed.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [load]);

  const create = async () => {
    if (!rfqId || !customerId) return setMessage("Select an RFQ and customer account.");
    await post("/api/v1/customer-quotes", {
      rfqId,
      customerId,
      markupPct: Number(markupPct),
      vatRate: Number(vatRate),
      validityDays: 30,
    }, "create");
  };

  const transition = (quote: CustomerQuote, action: string, decision = false) => post(
    `/api/v1/customer-quotes/${encodeURIComponent(quote.id)}/${decision ? "decision" : "transition"}`,
    { action },
    `${action}:${quote.id}`,
  );

  const convertQuote = (quote: CustomerQuote) => post(
    "/api/v1/sales-orders/from-quote",
    { quoteId: quote.id },
    `convert:${quote.id}`,
  );

  const transitionSalesOrder = (order: SalesOrder, action: "start" | "cancel") => post(
    `/api/v1/sales-orders/${encodeURIComponent(order.id)}/transition`,
    { action },
    `${action}:${order.id}`,
  );

  return (
    <section className="rounded-xl border border-outline-variant/30 bg-surface-container p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-on-surface">Customer quotes</h3>
        <button onClick={load} disabled={loading} title="Refresh customer quotes" className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-success disabled:opacity-50">
          <Icon name="refresh" />
        </button>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_90px_auto]">
        <select value={rfqId} onChange={(event) => setRfqId(event.target.value)} aria-label="Source RFQ" className="min-w-0 rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-xs text-on-surface">
          <option value="">Select source RFQ</option>
          {rfqs.map((rfq) => <option key={rfq.id} value={rfq.id}>{rfq.vessel} - {rfq.port} ({rfq.status})</option>)}
        </select>
        <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} aria-label="Customer account" className="min-w-0 rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-xs text-on-surface">
          <option value="">Select customer</option>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.customerCode})</option>)}
        </select>
        <label className="relative">
          <input value={markupPct} onChange={(event) => setMarkupPct(event.target.value)} inputMode="decimal" aria-label="Markup percentage" className="w-full rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 pr-7 text-xs text-on-surface" />
          <span className="absolute right-2 top-2 text-xs text-on-surface-variant">%</span>
        </label>
        <label className="relative">
          <input value={vatRate} onChange={(event) => setVatRate(event.target.value)} inputMode="decimal" aria-label="VAT rate" className="w-full rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 pr-7 text-xs text-on-surface" />
          <span className="absolute right-2 top-2 text-xs text-on-surface-variant">VAT</span>
        </label>
        <button onClick={create} disabled={busy !== null || !rfqId || !customerId} className="rounded-lg bg-success px-4 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">Create quote</button>
      </div>

      {!loading && customers.length === 0 && <p className="mt-3 text-sm text-warning">No customer accounts yet. An administrator can add them in Settings → Company setup → Customer account. Then refresh this panel. Shipping-company fleet profiles are managed separately in Purchase Orders.</p>}
      {!loading && rfqs.length === 0 && <p className="mt-3 text-sm text-on-surface-variant">Process and review an RFQ in this module before preparing a customer quote.</p>}
      {message && <div className="mt-3 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">{message}</div>}

      <div className="mt-4 space-y-3">
        {!loading && quotes.length === 0 ? (
          <div className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-4 text-xs text-on-surface-variant">No customer quotes yet.</div>
        ) : quotes.map((quote) => (
          <article key={quote.id} className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-on-surface">{quote.quoteNumber ?? quote.id.slice(0, 8)}</span>
                  <span className="rounded border border-success/20 bg-success/10 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-success">{quote.status}</span>
                </div>
                <p className="mt-1 text-xs text-secondary">{quote.customer} · {quote.vessel ?? "No vessel"} / {quote.port ?? "No port"}</p>
                <p className="mt-1 text-[0.62rem] text-on-surface-variant">{money(quote.netAmount, quote.currency)} net · {quote.marginPct.toFixed(2)}% margin · valid {new Date(quote.validUntil).toLocaleDateString()}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quote.status === "Draft" && <button onClick={() => transition(quote, "submit")} disabled={busy !== null} className="rounded bg-success/15 px-2.5 py-1.5 text-[0.65rem] font-semibold text-success">Submit</button>}
                {quote.status === "PendingApproval" && <button onClick={() => transition(quote, "approve", true)} disabled={busy !== null} className="rounded bg-success px-2.5 py-1.5 text-[0.65rem] font-semibold text-on-primary">Approve</button>}
                {quote.status === "PendingApproval" && <button onClick={() => transition(quote, "return", true)} disabled={busy !== null} className="rounded border border-warning/25 px-2.5 py-1.5 text-[0.65rem] font-semibold text-warning">Return</button>}
                {quote.status === "Approved" && <button onClick={() => transition(quote, "send")} disabled={busy !== null} className="rounded bg-success px-2.5 py-1.5 text-[0.65rem] font-semibold text-on-primary">Mark sent</button>}
                {quote.status === "Sent" && <button onClick={() => transition(quote, "accept")} disabled={busy !== null} className="rounded bg-success/15 px-2.5 py-1.5 text-[0.65rem] font-semibold text-success">Accept</button>}
                {quote.status === "Sent" && <button onClick={() => transition(quote, "decline")} disabled={busy !== null} className="rounded border border-warning/25 px-2.5 py-1.5 text-[0.65rem] font-semibold text-warning">Decline</button>}
                {quote.status === "Accepted" && !salesOrderByQuote.has(quote.id) && <button onClick={() => convertQuote(quote)} disabled={busy !== null} className="rounded bg-success px-2.5 py-1.5 text-[0.65rem] font-semibold text-on-primary">Create order</button>}
                {salesOrderByQuote.has(quote.id) && <span className="rounded border border-success/20 bg-success/10 px-2.5 py-1.5 font-mono text-[0.65rem] text-success">{salesOrderByQuote.get(quote.id)!.salesOrderNumber ?? "Order created"}</span>}
                {(["Draft", "PendingApproval", "Approved", "Sent"] as string[]).includes(quote.status) && <button onClick={() => transition(quote, "cancel")} disabled={busy !== null} title="Cancel quote" className="flex h-7 w-7 items-center justify-center rounded border border-error/20 text-error"><Icon name="close" /></button>}
              </div>
            </div>
            <div className="mt-3 grid gap-1.5">
              {quote.lines.map((line) => (
                <div key={line.id} className="grid gap-2 rounded border border-outline-variant/20 bg-surface-container px-3 py-2 text-[0.66rem] text-secondary md:grid-cols-[minmax(0,1fr)_100px_110px]">
                  <span className="truncate">{line.lineNumber}. {line.description} · {line.quantity} {line.unit}</span>
                  <span className="truncate text-on-surface-variant">{line.sourceSupplier ?? "Source quote"}</span>
                  <span className="text-right font-semibold text-on-surface">{money(line.unitPrice, quote.currency)}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-outline-variant/25 pt-4">
        <h3 className="text-sm font-semibold text-on-surface">Sales orders</h3>
        <span className="text-[0.65rem] text-on-surface-variant">{salesOrders.length} total</span>
      </div>
      <div className="mt-3 space-y-3">
        {!loading && salesOrders.length === 0 ? (
          <div className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-4 text-xs text-on-surface-variant">No sales orders yet.</div>
        ) : salesOrders.map((order) => {
          const deliveredLines = order.lines.filter((line) => line.status === "Delivered").length;
          return (
            <article key={order.id} className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-on-surface">{order.salesOrderNumber ?? order.id.slice(0, 8)}</span>
                    <span className="rounded border border-success/20 bg-success/10 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-success">{order.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-secondary">{order.customer} · {order.vessel ?? "No vessel"} / {order.port ?? "No port"}</p>
                  <p className="mt-1 text-[0.62rem] text-on-surface-variant">{money(order.netAmount, order.currency)} net · {deliveredLines}/{order.lines.length} lines delivered · fulfillment {order.fulfillmentOrderNumber}</p>
                </div>
                <div className="flex gap-1.5">
                  {order.status === "Confirmed" && <button onClick={() => transitionSalesOrder(order, "start")} disabled={busy !== null} className="rounded bg-success px-2.5 py-1.5 text-[0.65rem] font-semibold text-on-primary">Start fulfillment</button>}
                  {order.status === "Confirmed" && <button onClick={() => transitionSalesOrder(order, "cancel")} disabled={busy !== null} title="Cancel sales order" className="flex h-7 w-7 items-center justify-center rounded border border-error/20 text-error"><Icon name="close" /></button>}
                </div>
              </div>
              <div className="mt-3 grid gap-1.5">
                {order.lines.map((line) => (
                  <div key={line.id} className="grid gap-2 rounded border border-outline-variant/20 bg-surface-container px-3 py-2 text-[0.66rem] text-secondary md:grid-cols-[minmax(0,1fr)_120px]">
                    <span className="truncate">{line.lineNumber}. {line.description}</span>
                    <span className="text-right text-on-surface-variant">{line.deliveredQuantity}/{line.quantity} {line.unit} · {line.status}</span>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
