"use client";
import {useState} from "react";
interface Usage {retentionDays:number;totalAttempts:number;sampledAttempts:number;truncated:boolean;workflows:Array<{workflow:string;attempts:number;failures:number;retries:number;schemaValid:number;schemaInvalid:number;meanLatencyMs:number;usageKnown:number;measuredInput:number;measuredOutput:number;unpriced:number;priced:number;estimatedUsd:number}>;humanDecisions:Record<string,number>;routingEnabled:boolean}
export function AIUsagePanel() {
  const [data,setData]=useState<Usage|null>(null);const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function load(){setBusy(true);try{const r=await fetch("/api/v1/settings/ai/usage");const p=await r.json();if(!r.ok)throw new Error(p.error?.message ?? "Report unavailable");setData(p.data);setMessage("");}catch(e){setMessage(e instanceof Error ? e.message:"Report unavailable");}finally{setBusy(false);}}
  return <div className="mt-4 border-t border-outline-variant/30 pt-3">
    <button disabled={busy} onClick={()=>void load()} className="rounded-lg border border-outline-variant/30 px-3 py-2 text-xs text-on-surface">{busy ? "Loading usage…" : "View AI usage — last 30 days"}</button>
    {message && <p role="alert" className="mt-2 text-xs text-error">{message}</p>}
    {data && <div className="mt-3 space-y-2 text-xs text-on-surface-variant">
      <p>{data.totalAttempts} recorded attempts. {data.truncated ? "Showing the latest 10,000 attempts; totals below cover that sample." : "All retained attempts included."} Task routing: {data.routingEnabled ? "enabled" : "disabled"}.</p>
      <p>Estimated USD covers only measured usage with a current, verified pricing entry. Unpriced attempts have unknown cost; these are not provider bills. Unknown usage is excluded from measured token totals. Model responses and schema checks are separate from human acceptance.</p>
      <div role="region" aria-label="AI workflow usage" tabIndex={0} className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{["Workflow","Attempts / retries","Failures / schema invalid","Mean ms","Usage coverage","Measured input / output","Estimated USD / unpriced"].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{data.workflows.map(r=><tr key={r.workflow}><td className="p-2">{r.workflow}</td><td>{r.attempts} / {r.retries}</td><td>{r.failures} / {r.schemaInvalid}</td><td>{Math.round(r.meanLatencyMs)}</td><td>{r.usageKnown}/{r.attempts}</td><td>{r.measuredInput} / {r.measuredOutput}</td><td>{r.priced ? r.estimatedUsd.toFixed(6) : "Unknown"} / {r.unpriced}</td></tr>)}</tbody></table></div>
      <p>Explicit RFQ review decisions: {Object.entries(data.humanDecisions).map(([k,v])=>`${k.replaceAll("_"," ")}: ${v}`).join(" · ")}. These count decisions, including subsequent reviews; review time is not measured.</p>
    </div>}
  </div>;
}
