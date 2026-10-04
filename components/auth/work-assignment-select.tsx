"use client";

import { useEffect, useState } from "react";

interface Assignee { id: string; name: string; email: string; }

export function WorkAssignmentSelect({ endpoint, value, onUpdated, compact = false }: { endpoint: string; value: Assignee | null | undefined; onUpdated: () => void; compact?: boolean }) {
  const [users, setUsers] = useState<Assignee[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/v1/users/assignable").then((response) => response.json()).then((payload) => setUsers(payload.data ?? [])).catch(() => setUsers([]));
  }, []);

  async function assign(assignedToId: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignedToId: assignedToId || null }) });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Assignment failed.");
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Assignment failed."); }
    finally { setBusy(false); }
  }

  return <div className={compact ? "min-w-32" : "min-w-48"}>
    <label className="sr-only">Assigned employee</label>
    <select value={value?.id ?? ""} disabled={busy} onChange={(event) => void assign(event.target.value)} title={error ?? "Assigned employee"} className={`${compact ? "h-7 text-[0.62rem]" : "h-8 text-xs"} w-full rounded-md border border-outline-variant/15 bg-surface-base px-2 text-on-surface disabled:opacity-50`}>
      <option value="">Unassigned</option>
      {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
    </select>
    {error && !compact && <p className="mt-1 text-[0.6rem] text-error">{error}</p>}
  </div>;
}
