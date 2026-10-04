import type { ReactNode } from "react";

/** Shared truthful state announcement for document review workspaces. */
export function ReviewNotice({title, children, error = false}: {title:string; children:ReactNode; error?:boolean}) {
  return <div role={error ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${error ? "border-error/40 bg-error/5" : "border-outline-variant/30 bg-surface-container"}`}>
    <p className={`font-semibold ${error ? "text-error" : "text-on-surface"}`}>{title}</p>
    <div className="mt-1 text-on-surface-variant">{children}</div>
  </div>;
}
