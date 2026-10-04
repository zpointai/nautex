import { PERMISSIONS, type PermissionCode } from "@/lib/auth/permissions";

export interface AgentAction {
  agentId: string;
  action: string;
  label: string;
  mode: "local" | "provider" | "hybrid" | "mailbox";
  permission: PermissionCode;
  fields: { key: string; label: string; maxLength: number }[];
}
const description = [{ key: "description", label: "Product description", maxLength: 8000 }];
// Only actions with an implemented dispatcher belong here. Registry descriptions
// are not evidence that a workflow exists.
export const AGENT_ACTIONS: AgentAction[] = [
  { agentId: "backorder_follow_up", action: "draft_backorder_follow_up", label: "Draft supplier follow-up", mode: "local", permission: PERMISSIONS.PROCUREMENT_WRITE, fields: [{ key: "id", label: "Backorder ID or purchase order number", maxLength: 160 }] },
  { agentId: "backorder_reply_monitor", action: "monitor_backorder_replies", label: "Check overdue backorders", mode: "local", permission: PERMISSIONS.PROCUREMENT_WRITE, fields: [{ key: "scope", label: "Scope: active, critical or escalated", maxLength: 20 }] },
  { agentId: "backorder_reply_monitor", action: "check_supplier_mailbox", label: "Find possible supplier replies (Microsoft 365)", mode: "mailbox", permission: PERMISSIONS.PROCUREMENT_WRITE, fields: [{ key: "days", label: "Inbox lookback in days (1–30)", maxLength: 2 }] },
  { agentId: "finance_exception", action: "analyze_finance_exception", label: "Detect and review finance exceptions", mode: "local", permission: PERMISSIONS.FINANCE_WRITE, fields: [{ key: "id", label: "Finance exception ID, or all to check and review the open queue", maxLength: 160 }] },
  { agentId: "classification", action: "classify_hs", label: "Suggest HS classification", mode: "hybrid", permission: PERMISSIONS.APP_WRITE, fields: description },
  { agentId: "classification", action: "classify_impa", label: "Find IMPA matches", mode: "local", permission: PERMISSIONS.APP_WRITE, fields: description },
  { agentId: "classification", action: "identify_coo", label: "Find recorded country of origin", mode: "local", permission: PERMISSIONS.APP_WRITE, fields: description },
  { agentId: "classification", action: "normalize_description", label: "Normalize description", mode: "local", permission: PERMISSIONS.APP_WRITE, fields: description },
  { agentId: "rfq_intake", action: "parse_rfq", label: "Preview RFQ extraction", mode: "hybrid", permission: PERMISSIONS.PROCUREMENT_WRITE, fields: [{ key: "documentText", label: "RFQ text", maxLength: 50000 }] },
  { agentId: "supplier_discovery", action: "find_suppliers", label: "Find recorded suppliers", mode: "local", permission: PERMISSIONS.SUPPLIERS_WRITE, fields: [{ key: "query", label: "Supplier criteria", maxLength: 8000 }] },
  { agentId: "order_validation", action: "validate_order", label: "Review purchase order", mode: "provider", permission: PERMISSIONS.PROCUREMENT_APPROVE, fields: [{ key: "id", label: "Purchase order number", maxLength: 160 }] },
  { agentId: "procurement_validation", action: "validate_quote_vs_po", label: "Review quote against PO", mode: "provider", permission: PERMISSIONS.PROCUREMENT_WRITE, fields: [{ key: "quoteText", label: "Supplier quote text", maxLength: 25000 }, { key: "poText", label: "Purchase order text", maxLength: 25000 }] },
];
export function implementedAgent(id: string) {
  return ["command_router", "agreement_comparison", "nautex_po_intake"].includes(id) || AGENT_ACTIONS.some(action => action.agentId === id);
}
export function isModelProvider(provider: string | null | undefined) {
  return provider === "deepseek" || provider === "gemini";
}
