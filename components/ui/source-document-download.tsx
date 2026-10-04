"use client";
import { useState } from "react";
import type { StoredSourceDocument } from "@/lib/documents/source-types";

export function SourceDocumentDownload({ document, url }: { document: StoredSourceDocument; url: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message || "Source could not be downloaded.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = objectUrl; link.download = document.fileName;
      window.document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (e) { setError(e instanceof Error ? e.message : "Source could not be downloaded."); }
    finally { setBusy(false); }
  }
  return <div className="my-2">
    <button type="button" onClick={() => void download()} disabled={busy} className="rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-semibold text-on-surface disabled:opacity-50">
      {busy ? "Retrieving source…" : document.kind === "upload" ? "Download original file" : document.kind === "record_snapshot" ? "Download record snapshot" : "Download source text"}
    </button>
    {error && <p role="alert" className="mt-1 text-xs text-error">{error}</p>}
  </div>;
}
