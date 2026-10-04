import type { TokenUsage } from "./observability";
export interface AIPricing {status:"estimated"|"unpriced";estimatedCost:number|null;currency:"USD"|null;source:string|null;verifiedAt:string|null}
const unpriced: AIPricing={status:"unpriced",estimatedCost:null,currency:null,source:null,verifiedAt:null};
/** Verified standard text-only Gemini rates. No tools, cache storage, discounts or billed-cost claims. */
export const PRICING_CONFIGURATION={
  version:"2026-09-13-deepseek-v41",verifiedAt:"2026-09-07",expiresAt:"2026-10-07",
  source:"https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-pro-preview",
  model:"gemini-3.1-pro-preview",provider:"gemini",
  perMillion:{upTo200k:{input:2,output:12,cachedInput:0.2},over200k:{input:4,output:18,cachedInput:0.4}},
  unverifiedProviders:[],
};
export const DEEPSEEK_PRICING = {
  verifiedAt: "2026-09-13", expiresAt: "2026-10-13", flashEffectiveAt: "2026-09-10T04:00:00.000Z",
  source: "https://api-docs.deepseek.com/quick_start/pricing/",
};
export interface TokenRates {input:number;output:number;cachedInput:number;source:string;verifiedAt:string;period:"standard"|"peak"|"off_peak"}
/** Dated standard text rates. Budget reservations always use peak DeepSeek rates. */
export function getTokenRates(provider:string,model:string,now=new Date(),inputTokens=0,worstCase=false):TokenRates|null {
  const c=PRICING_CONFIGURATION;
  if(!Number.isFinite(now.getTime()) || !Number.isSafeInteger(inputTokens) || inputTokens<0)return null;
  if(provider==="deepseek" && ["deepseek-flash","deepseek-v4-flash","deepseek-v4-flash-vision-exp","deepseek-v4-pro"].includes(model)) {
    if(now < new Date(c.verifiedAt) || now >= new Date(DEEPSEEK_PRICING.expiresAt))return null;
    const currentFlash = now >= new Date(DEEPSEEK_PRICING.flashEffectiveAt);
    if(model === "deepseek-flash" && !currentFlash)return null;
    const weekday=now.getUTCDay()>=1 && now.getUTCDay()<=5, hour=now.getUTCHours();
    const peak=worstCase || (weekday && ((hour>=1 && hour<4)||(hour>=6 && hour<10)));
    const pro=model==="deepseek-v4-pro", factor=peak ? 1 : .5;
    return {input:(pro ? 1.32 : currentFlash ? .3 : .44)*factor,output:(pro ? 3.96 : currentFlash ? 1.2 : 1.32)*factor,cachedInput:(pro ? .044 : currentFlash ? .006 : .014)*factor,source:DEEPSEEK_PRICING.source,verifiedAt:currentFlash ? DEEPSEEK_PRICING.verifiedAt : c.verifiedAt,period:peak?"peak":"off_peak"};
  }
  if(provider!=="gemini" || now < new Date(c.verifiedAt) || now >= new Date(c.expiresAt))return null;
  const rate=model===c.model ? inputTokens<=200000 ? c.perMillion.upTo200k : c.perMillion.over200k
    : model==="gemini-3-flash-preview" ? {input:.5,output:3,cachedInput:.05}
    : model==="gemini-3.5-flash-lite" ? {input:.3,output:2.5,cachedInput:.03} : null;
  return rate ? {...rate,source:"https://ai.google.dev/gemini-api/docs/pricing",verifiedAt:c.verifiedAt,period:"standard"} : null;
}
export function estimateCost(provider:string,model:string,u:TokenUsage,now=new Date()):AIPricing {
  if(u.input===null || u.output===null || u.cachedInput===null || (!u.outputIncludesReasoning && u.reasoning===null) || u.cachedInput>u.input)return {...unpriced};
  const rate=getTokenRates(provider,model,now,u.input);
  if(!rate)return {...unpriced};
  const output=u.output+(u.outputIncludesReasoning ? 0 : u.reasoning!);
  return {status:"estimated",estimatedCost:((u.input-u.cachedInput)*rate.input+u.cachedInput*rate.cachedInput+output*rate.output)/1e6,currency:"USD",source:rate.source,verifiedAt:rate.verifiedAt};
}
