import type { AIWorkflow } from "./observability";
import { AI_PROVIDER_MODELS, type AIConfig } from "./config";
type Tier="default"|"fast"|"reasoning";
/** Disabled by default. Routes only within the already authorized active provider. */
export function taskTier(workflow:AIWorkflow|undefined,current:Tier|undefined,env:Record<string,string|undefined>=process.env):Tier|undefined {
  if(env.NAUTEX_AI_TASK_ROUTING_ENABLED !== "true" || !workflow)return current;
  try {
    const tier=JSON.parse(env.NAUTEX_AI_TASK_TIERS ?? "{}")[workflow];
    return ["default","fast","reasoning"].includes(tier) ? tier : current;
  } catch {return current;}
}

/** 0.3.5: both profiles passed all 64 synthetic RFQ cases; other workflows retain their models.
 * Reversible via NAUTEX_AI_RFQ_OPTIMIZATION_ENABLED=false. Explicit task/model/reasoning overrides win.
 */
export function evaluatedRfqOptions<T extends {workflow?:AIWorkflow;tier?:Tier;reasoning?:"disabled"|"low"|"high"}>(
  config:AIConfig,options:T,env:Record<string,string|undefined>=process.env,
):T {
  if(env.NAUTEX_AI_RFQ_OPTIMIZATION_ENABLED==="false"||env.NAUTEX_AI_TASK_ROUTING_ENABLED==="true"
    ||config.provider!=="gemini"||options.workflow!=="rfq_extraction"||options.reasoning!==undefined
    ||options.tier!==undefined&&options.tier!=="default"
    ||config.defaultModel!==AI_PROVIDER_MODELS.gemini.default||config.fastModel!==AI_PROVIDER_MODELS.gemini.fast)return options;
  return {...options,tier:"fast",reasoning:"low"};
}
