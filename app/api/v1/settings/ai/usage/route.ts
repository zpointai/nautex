import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { AIAttempt } from "@/lib/ai/observability";

export async function GET(req:Request) {
  const auth=await authorizeOrganizationRequest(req,PERMISSIONS.ADMIN_USERS);
  if(!auth.ok)return auth.response;
  try {
    const where={organizationId:auth.context.organizationId,entityType:"ai_request",eventType:"ai_attempt"};
    await prisma.auditEvent.deleteMany({where:{...where,createdAt:{lt:new Date(Date.now()-30*86400000)}}});
    const [total,events,humanReviews]=await Promise.all([
      prisma.auditEvent.count({where}),
      prisma.auditEvent.findMany({where,orderBy:{createdAt:"desc"},take:10000,select:{metadata:true}}),
      prisma.auditEvent.findMany({where:{organizationId:auth.context.organizationId,entityType:"rfq_review",eventType:"human_review",createdAt:{gte:new Date(Date.now()-30*86400000)}},take:10000,orderBy:{createdAt:"desc"},select:{metadata:true}}),
    ]);
    const groups=new Map<string,{workflow:string;attempts:number;failures:number;retries:number;schemaValid:number;schemaInvalid:number;durationMs:number;measuredInput:number;measuredOutput:number;usageKnown:number;unpriced:number;estimatedUsd:number;priced:number}>();
    for(const event of events) {
      const m=event.metadata as unknown as AIAttempt & {workflow:string};
      const workflow=m.workflow || "other";
      const row=groups.get(workflow) ?? {workflow,attempts:0,failures:0,retries:0,schemaValid:0,schemaInvalid:0,durationMs:0,measuredInput:0,measuredOutput:0,usageKnown:0,unpriced:0,estimatedUsd:0,priced:0};
      row.attempts++;row.failures+=Number(m.outcome!=="response_received");row.retries+=Number(m.attempt>1);
      row.schemaValid+=Number(m.schemaValidation==="valid");row.schemaInvalid+=Number(m.schemaValidation==="invalid");row.durationMs+=m.durationMs;
      if(m.usage.input!==null && m.usage.output!==null)row.usageKnown++;
      row.measuredInput+=m.usage.input ?? 0;row.measuredOutput+=m.usage.output ?? 0;
      if(m.pricing.status === "estimated" && m.pricing.estimatedCost !== null){row.estimatedUsd+=m.pricing.estimatedCost;row.priced++;}else row.unpriced++;
      groups.set(workflow,row);
    }
    const decisions={accepted_unchanged:0,accepted_with_corrections:0,rejected:0};
    for(const e of humanReviews){const outcome=(e.metadata as {outcome?:string}).outcome;if(outcome && outcome in decisions)decisions[outcome as keyof typeof decisions]++;}
    return ok({retentionDays:30,totalAttempts:total,sampledAttempts:events.length,truncated:total>events.length,
      workflows:[...groups.values()].map(r=>({...r,meanLatencyMs:r.durationMs/r.attempts})),humanDecisions:decisions,
      pricingStatus:"partial_coverage",routingEnabled:process.env.NAUTEX_AI_TASK_ROUTING_ENABLED === "true",reviewEffort:"not_measured"});
  } catch {return fail("AI_USAGE_UNAVAILABLE","AI usage report is temporarily unavailable.",503);}
}
