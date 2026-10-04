"use client";
import { useState } from "react";
import type { ReplyCandidate } from "@/lib/mailbox/microsoft365";
export function MailboxReplyReview({ runId, output }: { runId: string; output: unknown }) {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState<string[]>([]);
  const result = output as { candidates?: ReplyCandidate[]; truncated?: boolean; scanned?: number; note?: string } | null;
  if (!Array.isArray(result?.candidates)) return null;
  async function review(candidate: ReplyCandidate, status: string) {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/v1/agents/mailbox-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, messageId: candidate.messageId, backorderId: candidate.backorderId, status }) }); const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Reply review failed."); setReviewed(rows => [...rows, `${candidate.messageId}:${candidate.backorderId}`]); setMessage("Review recorded. The backorder status is unchanged."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Reply review failed."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 text-sm"><p>{result.scanned} messages checked. {result.note}</p>{result.truncated && <p className="text-warning">Scan limit reached. These are partial results; narrow the time range or review the mailbox directly.</p>}{result.candidates.map(candidate => <div key={`${candidate.messageId}:${candidate.backorderId}`} className="rounded border border-outline-variant/20 p-3"><p className="font-medium">{candidate.poNumber} · {candidate.subject}</p><p>{candidate.sender} · {new Date(candidate.receivedAt).toLocaleString()}</p>{candidate.webLink && <a href={candidate.webLink} target="_blank" rel="noreferrer" className="text-primary underline">Review original in Outlook</a>}{reviewed.includes(`${candidate.messageId}:${candidate.backorderId}`) ? <p>Reviewed</p> : <div className="mt-2 flex gap-3"><button disabled={busy} className="text-primary" onClick={() => void review(candidate, "Accepted")}>Accept as supporting reply</button><button disabled={busy} className="text-outline" onClick={() => void review(candidate, "Rejected")}>Reject match</button></div>}</div>)}{message && <p role="status">{message}</p>}</div>;
}
