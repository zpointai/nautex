"use client";

import { useCallback, useEffect, useState } from "react";

const ROLES = [["operator", "Operator"], ["buyer", "Buyer"], ["senior-buyer", "Senior Buyer"], ["manager", "Manager"], ["finance", "Finance"], ["admin", "Administrator"], ["read-only", "Read Only"]] as const;
type Status = "Active" | "Suspended" | "Disabled";
interface Employee { id: string; name: string; email: string; status: Status; lastLoginAt: string | null; roles: Array<{ code: string; name: string }>; legalEntityIds: string[]; }
interface Entity { id: string; name: string }

export function EmployeeAdminPanel({ enabled, currentUserId = null, availableEntities }: { enabled: boolean; currentUserId?: string | null; availableEntities?: Entity[] }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { roleCode: string; status: Status; legalEntityIds: string[] }>>({});
  const [entities, setEntities] = useState<Entity[]>([]);
  const [createEntities, setCreateEntities] = useState<string[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; actorName: string; entityNumber: string; eventType: string; createdAt: string }>>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", roleCode: "operator" });
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch("/api/v1/admin/users");
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Employee accounts could not be loaded.");
    const rows = payload.data as Employee[];
    setEmployees(rows);
    setEntities(payload.meta?.legalEntities ?? []); setHistory(payload.meta?.history ?? []);
    setDrafts(Object.fromEntries(rows.map((employee) => [employee.id, { roleCode: employee.roles[0]?.code ?? "read-only", status: employee.status, legalEntityIds: employee.legalEntityIds ?? [] }])));
  }, [enabled]);

  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  if (!enabled) return null;
  const entityOptions = availableEntities ?? entities;

  async function createEmployee(event: React.FormEvent) {
    event.preventDefault(); setPending("create"); setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, legalEntityIds: createEntities }) });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Employee creation failed.");
      setForm({ name: "", email: "", password: "", roleCode: "operator" }); setCreateEntities([]); await load(); setMessage("Employee account created. Share their initial password through your agreed secure channel.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Employee creation failed."); }
    finally { setPending(null); }
  }

  async function updateEmployee(employee: Employee) {
    const draft = drafts[employee.id]; if (!draft) return;
    setPending(employee.id); setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(employee.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Employee update failed.");
      if (employee.id === currentUserId) { window.location.reload(); return; }
      await load(); setMessage(`${employee.name} updated. They must sign in again.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Employee update failed."); }
    finally { setPending(null); }
  }

  /* Sets a new password for an employee who can no longer sign in. The API
     revokes every active session for that user, so they must sign in again
     with the new password everywhere. */
  async function resetEmployeePassword(employee: Employee) {
    setPending(`reset:${employee.id}`); setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(employee.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Password reset failed.");
      setResetFor(null); setResetPassword("");
      if (employee.id === currentUserId) { window.location.reload(); return; }
      await load();
      setMessage(`Password reset for ${employee.name}. Their active sessions were signed out.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Password reset failed."); }
    finally { setPending(null); }
  }

  return <section className="border-t border-outline-variant/15 pt-3">
    <div className="mb-3 flex items-center gap-2"><span className="material-symbols-outlined text-base text-primary">group</span><h3 className="text-xs font-semibold text-on-surface">Employee accounts</h3></div>
    <fieldset disabled={pending !== null}>
    <form onSubmit={createEmployee} className="grid grid-cols-2 gap-2">
      <Input label="Name" value={form.name} onChange={(name) => setForm((value) => ({ ...value, name }))} />
      <Input label="Email" type="email" value={form.email} onChange={(email) => setForm((value) => ({ ...value, email }))} />
      <Input label="Initial password" type="password" value={form.password} onChange={(password) => setForm((value) => ({ ...value, password }))} />
      <label className="text-[0.62rem] text-outline">Role<select value={form.roleCode} onChange={(event) => setForm((value) => ({ ...value, roleCode: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-outline-variant/15 bg-surface-base px-2 text-xs text-on-surface">{ROLES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <EntityPicker entities={entityOptions} selected={createEntities} onChange={setCreateEntities} disabled={pending !== null} />
      <button disabled={pending !== null} className="col-span-2 h-9 rounded-md bg-primary text-xs font-semibold text-on-primary disabled:opacity-50">{pending === "create" ? "Creating..." : "Create employee"}</button>
    </form>
    <div className="mt-3 divide-y divide-outline-variant/10 border-y border-outline-variant/10">{employees.map((employee) => { const draft = drafts[employee.id]; return <div key={employee.id} className="py-2.5">
      <div className="mb-2 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-medium text-on-surface">{employee.name}</p><p className="truncate text-[0.62rem] text-outline">{employee.email}</p></div><span className="text-[0.58rem] text-outline">{employee.lastLoginAt ? new Date(employee.lastLoginAt).toLocaleDateString() : "Never signed in"}</span></div>
      {draft && <div className="grid grid-cols-[1fr_1fr_auto] gap-2"><select value={draft.roleCode} onChange={(event) => setDrafts((value) => ({ ...value, [employee.id]: { ...draft, roleCode: event.target.value } }))} className="h-8 rounded-md border border-outline-variant/15 bg-surface-base px-2 text-[0.65rem] text-on-surface">{ROLES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select><select value={draft.status} onChange={(event) => setDrafts((value) => ({ ...value, [employee.id]: { ...draft, status: event.target.value as Status } }))} className="h-8 rounded-md border border-outline-variant/15 bg-surface-base px-2 text-[0.65rem] text-on-surface"><option>Active</option><option>Suspended</option><option>Disabled</option></select><button type="button" disabled={pending === employee.id} onClick={() => void updateEmployee(employee)} className="h-8 rounded-md border border-primary/20 px-2 text-[0.65rem] font-medium text-primary disabled:opacity-50">Save</button></div>}
      {draft && <EntityPicker entities={entityOptions} selected={draft.legalEntityIds} onChange={legalEntityIds => setDrafts(value => ({ ...value, [employee.id]: { ...draft, legalEntityIds } }))} disabled={pending !== null} />}
      {resetFor === employee.id ? (
        <div className="mt-2 rounded-md border border-outline-variant/15 bg-surface-base/50 p-2">
          <Input label="New password" type="password" required={false} value={resetPassword} onChange={setResetPassword} />
          <p className={`mt-1 text-[0.58rem] leading-4 ${employee.id === currentUserId ? "text-warning" : "text-outline"}`}>
            {employee.id === currentUserId
              ? "At least 12 characters. This is your own account — you will be signed out immediately and must sign in again with the new password."
              : `At least 12 characters. Signs ${employee.name} out of all active sessions.`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={resetPassword.length < 12 || pending === `reset:${employee.id}`} onClick={() => void resetEmployeePassword(employee)} className="h-8 rounded-md bg-primary px-2.5 text-[0.65rem] font-semibold text-on-primary disabled:opacity-50">
              {pending === `reset:${employee.id}` ? "Resetting..." : "Set password"}
            </button>
            <button type="button" onClick={() => { setResetFor(null); setResetPassword(""); }} className="h-8 rounded-md px-2 text-[0.65rem] text-outline hover:text-on-surface-variant">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setResetFor(employee.id); setResetPassword(""); setMessage(null); }} className="mt-2 flex items-center gap-1 text-[0.62rem] font-medium text-outline transition hover:text-primary">
          <span aria-hidden="true" className="material-symbols-outlined text-sm leading-none">key</span>{employee.id === currentUserId ? "Change my password" : "Reset password"}
        </button>
      )}
    </div>; })}</div>
    </fieldset>
    {message && <p role="status" className="mt-2 text-sm leading-5 text-on-surface-variant">{message}</p>}
    <details className="mt-3 text-sm"><summary className="cursor-pointer">Recent employee access changes</summary><ul className="mt-2 space-y-2">{history.map(entry => <li key={entry.id}>{new Date(entry.createdAt).toLocaleString()} · {entry.actorName} · {entry.eventType.replaceAll("_", " ")} · {entry.entityNumber}</li>)}</ul>{!history.length && <p>No changes recorded.</p>}</details>
  </section>;
}

function EntityPicker({ entities, selected, onChange, disabled }: { entities: Entity[]; selected: string[]; onChange: (value: string[]) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="col-span-2 my-2 rounded-md border border-outline-variant/20 p-2 text-sm"><legend>Seller entity access</legend>{entities.length ? entities.map(entity => <label key={entity.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={selected.includes(entity.id)} onChange={event => onChange(event.target.checked ? [...selected, entity.id] : selected.filter(id => id !== entity.id))} />{entity.name}</label>) : <p>Create seller entities in Company setup first.</p>}<p className="mt-1 text-xs text-outline">Only selected entities are granted. Save the employee to apply changes.</p></fieldset>;
}

function Input({ label, value, onChange, type = "text", required = true }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return <label className="text-[0.62rem] text-outline">{label}
    <div className="relative mt-1">
      <input
        aria-label={label}
        required={required}
        type={isPassword && revealed ? "text" : type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-9 w-full rounded-md border border-outline-variant/15 bg-surface-base text-xs text-on-surface outline-none focus:border-primary/40 ${isPassword ? "pl-2 pr-9" : "px-2"}`}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          title={revealed ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-on-surface-variant transition hover:text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">{revealed ? "visibility_off" : "visibility"}</span>
        </button>
      )}
    </div>
  </label>;
}
