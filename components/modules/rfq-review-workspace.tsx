"use client";
import { useEffect, useMemo, useState } from "react";
import { reviewIssues, type ReviewFields } from "@/lib/rfq/review";
import type { RFQResult } from "@/types/procurement";
import { ReviewNotice } from "@/components/ui/review-notice";
import { SourceDocumentDownload } from "@/components/ui/source-document-download";

const inputClass = "w-full rounded-lg border border-outline-variant/40 bg-surface-lowest p-2 text-sm text-on-surface focus-visible:outline-2 focus-visible:outline-success";
export function RfqReviewWorkspace({result,onSaved,onClose}:{result:RFQResult;onSaved:(result:RFQResult)=>void;onClose:()=>void}) {
  const [lines,setLines] = useState<ReviewFields[]>(()=>result.lines.map(l=>({...l.originalItem,currency:l.originalItem.currency ?? ""})));
  const [selected,setSelected]=useState(Math.min(result.review?.selectedLine ?? 0,Math.max(0,lines.length-1)));
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState(false);
  const [duplicatesAcknowledged,setDuplicatesAcknowledged]=useState(false);
  const issues=useMemo(()=>reviewIssues(lines),[lines]);
  const unresolved=issues.filter(row=>row.length).length;
  const line=lines[selected];
  const original=result.review?.originals[selected];
  useEffect(()=>{
    const handler=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",handler); return ()=>window.removeEventListener("beforeunload",handler);
  },[dirty]);
  function change(field:keyof ReviewFields,value:string|number) {
    setLines(current=>current.map((l,i)=>i===selected ? {...l,[field]:value}:l)); setDirty(true); setDuplicatesAcknowledged(false);
  }
  async function save(action:"save"|"confirm"|"reject") {
    setBusy(true);setMessage("");setError(false);
    try {
      const response=await fetch(`/api/v1/rfqs/${encodeURIComponent(result.rfqId!)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({lines,selectedLine:selected,updatedAt:result.updatedAt,action,duplicatesAcknowledged})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error?.message ?? "Could not save review.");
      const reopened=await fetch(`/api/v1/rfqs/${encodeURIComponent(result.rfqId!)}`);
      const saved=await reopened.json();
      if(!reopened.ok) throw new Error("Saved, but reopening failed. Reopen the RFQ from recent records.");
      setDirty(false);onSaved(saved.data);
      setMessage(action==="confirm" ? "Extraction confirmed. Supplier inquiries still require your explicit action." : action==="reject" ? "Extraction rejected. Downstream use is blocked." : "Draft and review position saved.");
    } catch(e) {setError(true);setMessage(e instanceof Error ? e.message : "Save failed.");} finally {setBusy(false);}
  }
  return <section aria-label="RFQ extraction review" className="space-y-4 min-w-0">
    <ReviewNotice title={result.review?.status === "confirmed" ? "Extraction confirmed" : result.review?.status === "rejected" ? "Extraction rejected" : "Extraction draft — review required"}>
      {lines.length} retained lines · {unresolved} with issues · {dirty ? "Unsaved corrections" : "Saved draft"}. Source coordinates are unavailable; compare with the preserved text. Missing currency remains unspecified.
    </ReviewNotice>
    {message && <ReviewNotice title={error ? "Review not saved" : "Review saved"} error={error}>{message}</ReviewNotice>}
    <div className="sticky top-0 z-10 flex flex-wrap gap-2 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
      <button disabled={busy} onClick={()=>void save("save")} className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50">{busy ? "Saving…" : "Save review"}</button>
      <button disabled={busy} onClick={()=>void save("confirm")} className="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm text-on-surface">Confirm extraction</button>
      <button disabled={busy} onClick={()=>void save("reject")} className="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm text-on-surface">Reject extraction</button>
      <a aria-disabled={dirty || result.review?.status !== "confirmed"} href={!dirty && result.review?.status === "confirmed" ? `#procurementValidator:${encodeURIComponent(result.rfqId!)}` : undefined} className="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm text-on-surface aria-disabled:opacity-50">Compare supplier quote</a>
      <button disabled={dirty || busy} onClick={onClose} className="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm text-on-surface disabled:opacity-50">Close review</button>
    </div>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
      <div className="min-w-0 rounded-xl border border-outline-variant/30 bg-surface-container p-4">
        <h3 className="font-semibold text-on-surface">Source text</h3>
        {result.review?.sourceDocument && result.rfqId
          ? <SourceDocumentDownload document={result.review.sourceDocument} url={`/api/v1/rfqs/${encodeURIComponent(result.rfqId)}/source`} />
          : <p className="my-2 text-xs text-on-surface-variant">Original file was not retained for this historical record.</p>}
        <p className="my-2 break-words text-xs text-on-surface-variant">{result.review?.fileName || "Text intake"} · {result.review?.sourceKind === "model" ? "Model interpretation — verify every field" : "Parser extraction — verify every field"}</p>
        {result.review?.warnings.map((w,i)=><p key={i} className="mb-2 text-sm text-warning">{w}</p>)}
        <pre tabIndex={0} aria-label="Preserved RFQ source text" className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-lowest p-3 text-xs leading-6 text-on-surface-variant">{result.review?.sourceText || "Original source unavailable for this record."}</pre>
      </div>
      <div className="min-w-0 space-y-3">
        <label className="block text-sm text-on-surface">Review line
          <select aria-label="Review line" className={`${inputClass} mt-1`} value={selected} onChange={e=>{setSelected(Number(e.target.value));setDirty(true);}}>
            {lines.map((l,i)=><option key={i} value={i}>{i+1}. {l.specifications.slice(0,70) || "Missing description"}{issues[i].length ? ` — ${issues[i].length} issue(s)` : ""}</option>)}
          </select>
        </label>
        {line && <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 space-y-3">
          <div className="flex justify-between gap-2"><button disabled={!selected} onClick={()=>{setSelected(selected-1);setDirty(true);}} className="text-sm text-on-surface disabled:opacity-40">Previous line</button><span className="text-sm text-on-surface-variant">{selected+1} / {lines.length}</span><button disabled={selected>=lines.length-1} onClick={()=>{setSelected(selected+1);setDirty(true);}} className="text-sm text-on-surface disabled:opacity-40">Next line</button></div>
          {issues[selected].length>0 && <ul aria-label="Line issues" className="list-disc pl-5 text-sm text-warning">{issues[selected].map(issue=><li key={issue}>{issue}</li>)}</ul>}
          <label className="block text-sm text-on-surface">Description<textarea value={line.specifications} onChange={e=>change("specifications",e.target.value)} className={`${inputClass} mt-1`} rows={3}/></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-sm text-on-surface">Quantity<input type="number" step="any" value={line.quantity || ""} placeholder="Missing" onChange={e=>change("quantity",Number(e.target.value))} className={`${inputClass} mt-1`}/></label>
            <label className="text-sm text-on-surface">Unit<input value={line.unit} placeholder="Missing" onChange={e=>change("unit",e.target.value)} className={`${inputClass} mt-1`}/></label>
            <label className="text-sm text-on-surface">Currency<input value={line.currency ?? ""} maxLength={3} placeholder="Unspecified" onChange={e=>change("currency",e.target.value.toUpperCase())} className={`${inputClass} mt-1`}/></label>
          </div>
          <details><summary className="cursor-pointer text-sm text-on-surface">Original extracted values and human changes</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs text-on-surface-variant">{JSON.stringify(original ?? null,null,2)}</pre><p className="mt-2 text-xs text-on-surface-variant">{result.review?.edits.filter(e=>e.line===selected).length ?? 0} saved correction entries. Edited values appear in the fields above.</p></details>
          <p className="text-xs text-on-surface-variant">Supplier matches are separate below. Changing a line clears its previous supplier prices until new evidence is recorded.</p>
        </div>}
        {issues.some(row=>row.some(i=>i.startsWith("Possible duplicate"))) && <label className="flex gap-2 text-sm text-on-surface"><input type="checkbox" checked={duplicatesAcknowledged} onChange={e=>setDuplicatesAcknowledged(e.target.checked)}/>I checked possible duplicate lines against the source and intend to retain them.</label>}
      </div>
    </div>
  </section>;
}
