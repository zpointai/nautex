import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { estimateCost, type AIPricing } from "./pricing";

export type AIWorkflow = "rfq_extraction" | "procurement_comparison" | "hs_assistance" | "order_risk" | "other" | "connection_test";
export interface AIObservationOptions {
  workflow?: AIWorkflow;
  promptVersion?: string;
  schemaVersion?: string;
  signal?: AbortSignal;
  /** Server-owned context only; never copied from request bodies or model output. */
  organizationId?: string;
}
export interface TokenUsage {
  input: number | null;
  output: number | null;
  cachedInput: number | null;
  reasoning: number | null;
  total: number | null;
  outputIncludesReasoning: boolean;
}
const count=(v:unknown)=>typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function parseUsage(provider:string, value:unknown):TokenUsage {
  const u=(value && typeof value === "object" ? value : {}) as Record<string,unknown>;
  const details=(u.completion_tokens_details ?? {}) as Record<string,unknown>;
  return provider === "gemini" ? {input:count(u.promptTokenCount),output:count(u.candidatesTokenCount),cachedInput:count(u.cachedContentTokenCount),reasoning:count(u.thoughtsTokenCount),total:count(u.totalTokenCount),outputIncludesReasoning:false}
    : {input:count(u.prompt_tokens),output:count(u.completion_tokens),cachedInput:count(u.prompt_cache_hit_tokens),reasoning:count(details.reasoning_tokens),total:count(u.total_tokens),outputIncludesReasoning:true};
}
export type ErrorCategory = "none" | "cancelled" | "timeout" | "rate_limit" | "unavailable" | "transport" | "truncated" | "empty" | "schema" | "malformed" | "provider";
export function errorCategory(message:string|null):ErrorCategory {
  if(!message)return "none";
  if(/abort|cancel/i.test(message))return "cancelled";
  if(/timeout|timed out/i.test(message))return "timeout";
  if(/429/.test(message))return "rate_limit";
  if(/not configured|not implemented|404|503|Unknown provider/.test(message))return "unavailable";
  if(/did not complete/.test(message))return "truncated";
  if(/Empty response/.test(message))return "empty";
  if(/schema/.test(message))return "schema";
  if(/parse|JSON/.test(message))return "malformed";
  if(/fetch|network|ECONN/.test(message))return "transport";
  return "provider";
}
export interface AIAttempt {
  attempt:number; provider:string; model:string; startedAt:string; endedAt:string; durationMs:number;
  outcome:"response_received"|"failed"|"cancelled"; errorCategory:ErrorCategory; schemaValidation:"not_requested"|"not_run"|"json_only"|"valid"|"invalid";
  reasoningSetting:string; fallbackReason:string|null; usage:TokenUsage;
  pricing:AIPricing;
}
type Scope={attempts:AIAttempt[];usage:TokenUsage|null;workflow:AIWorkflow};
const scope=new AsyncLocalStorage<Scope>();
export async function observedFetch(provider:string,url:string,init:RequestInit) {
  const response=await fetch(url,init);
  const context=scope.getStore();
  if(context) {
    const body=await response.clone().json().catch(()=>null);
    context.usage=parseUsage(provider,provider === "gemini" ? body?.usageMetadata : body?.usage);
  }
  return response;
}
type Outcome={ok:boolean;error:string|null;model:string;provider:string};
export async function observeAttempt<T extends Outcome>(run:()=>Promise<T>, options:{provider:string;model:string;reasoning:string;json:boolean}):Promise<T> {
  const context=scope.getStore();
  const started=Date.now();
  if(context)context.usage=null;
  let result:Outcome|null=null;
  let thrown:unknown;
  try {const value=await run();result=value;return value;} catch(e){thrown=e;throw e;} finally {
    if(context) {
      const category=errorCategory(result?.error ?? (thrown instanceof Error ? thrown.name+": "+thrown.message : null));
      context.attempts.push({attempt:context.attempts.length+1,provider:options.provider,model:options.model,startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),durationMs:Date.now()-started,
        outcome:category === "cancelled" ? "cancelled" : result?.ok ? "response_received" : "failed",errorCategory:category,
        schemaValidation:options.json ? "not_run" : "not_requested",reasoningSetting:options.reasoning,
        fallbackReason:context.attempts.length ? "same_provider_empty_json_retry" : null, usage:context.usage ?? parseUsage(options.provider,null),
        pricing:estimateCost(options.provider,options.model,context.usage ?? parseUsage(options.provider,null))});
    }
  }
}
const label=(value:string|undefined)=>value && /^[a-zA-Z0-9._:-]{1,80}$/.test(value) ? value : "unspecified";
export async function recordAttempts(organizationId:string,requestId:string,workflow:AIWorkflow,opts:AIObservationOptions,attempts:AIAttempt[]) {
  // Only this explicit metadata shape is persisted. Never spread vendor objects, prompts or errors.
  await prisma.$transaction(async tx=>{
    await tx.auditEvent.deleteMany({where:{organizationId,entityType:"ai_request",eventType:"ai_attempt",createdAt:{lt:new Date(Date.now()-30*86400000)}}});
    await tx.auditEvent.createMany({data:attempts.map(a=>({organizationId,entityType:"ai_request",entityId:requestId,eventType:"ai_attempt",sourceModule:"ai",requestId,
      metadata:{version:1,workflow,logicalRequestId:requestId,promptVersion:label(opts.promptVersion),schemaVersion:label(opts.schemaVersion),...a,model:label(a.model)} as unknown as Prisma.InputJsonValue}))});
  });
}
export async function observeAI<T extends Outcome>(opts:AIObservationOptions,json:boolean,run:()=>Promise<T>):Promise<T> {
  const context:Scope={attempts:[],usage:null,workflow:opts.workflow ?? "other"};
  const requestId=randomUUID();
  return scope.run(context,async()=>{
    const result=await run();
    const last=context.attempts.at(-1);
    if(last && json) {
      last.schemaValidation=result.ok ? ("validate" in opts && typeof opts.validate === "function" ? "valid" : "json_only") : ["schema","malformed"].includes(errorCategory(result.error)) ? "invalid" : "not_run";
      if(!result.ok){last.errorCategory=errorCategory(result.error);last.outcome=last.errorCategory === "cancelled" ? "cancelled" : "failed";}
    }
    if(!last) {
      const now=new Date().toISOString();
      context.attempts.push({attempt:1,provider:result.provider,model:result.model,startedAt:now,endedAt:now,durationMs:0,outcome:"failed",errorCategory:errorCategory(result.error),schemaValidation:"not_run",reasoningSetting:"not_applicable",fallbackReason:null,usage:parseUsage(result.provider,null),pricing:{status:"unpriced",estimatedCost:null,currency:null,source:null,verifiedAt:null}});
    }
    let organizationId=opts.organizationId;
    if(!organizationId) try {
      const {headers}=await import("next/headers");
      const {getAuthContext}=await import("@/lib/auth/authorization");
      organizationId=(await getAuthContext(await headers()))?.organizationId ?? undefined;
    } catch { /* Non-HTTP callers supply an explicit verified organization context. */ }
    let telemetryStatus:"recorded"|"unscoped"|"unavailable"="unscoped";
    if(organizationId) try {await recordAttempts(organizationId,requestId,context.workflow,opts,context.attempts);telemetryStatus="recorded";}
    catch {telemetryStatus="unavailable";console.warn("AI operational telemetry could not be persisted.");}
    return {...result,requestId,telemetryStatus,attempts:context.attempts};
  });
}
