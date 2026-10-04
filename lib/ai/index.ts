/**
 * AI Provider — Public API
 *
 * Import from "@/lib/ai" in API routes:
 *
 *   import { generateText, generateJSON, isAIConfigured } from "@/lib/ai";
 *
 * Import module services from "@/lib/ai/services":
 *
 *   import { hsCode, rfq, procurement } from "@/lib/ai/services";
 */

// Core provider
export { generateText, generateJSON } from "./provider";
export type { AIGenerateOptions, AIResult } from "./provider";

// Configuration
export { getAIConfig, isAIConfigured } from "./config";
export type { AIProvider, AIConfig } from "./config";

// Orchestration types (for future agent system)
export type {
  AgentDomain,
  AgentStatus,
  AgentTask,
  ApprovalRequest,
  ApprovalStatus,
  AgentException,
  AuditEntry,
  AgentCommand,
} from "./types";
