/**
 * AI Services — Module-specific AI logic
 *
 * Each service encapsulates the AI prompts, types, and parsing logic
 * for a specific domain module. API routes delegate to these services
 * rather than calling generateJSON/generateText directly.
 *
 * To activate a new module:
 *   1. Create lib/ai/services/<module>.ts
 *   2. Export it here
 *   3. Call it from the corresponding API route
 */

export * as hsCode from "./hs-code";
export * as rfq from "./rfq";
export * as procurement from "./procurement";
export * as orderValidation from "./order-validation";
export * as poIntake from "../../purchase-orders/intake-agent";
