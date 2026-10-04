import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const extended=process.argv.includes('--all-models');
  const cases=[{provider:'deepseek',model:'deepseek-flash',input:0.30,output:1.20},
    {provider:'gemini',model:'gemini-3-flash-preview',input:0.50,output:3.00},
    ...(extended?[{provider:'deepseek',model:'deepseek-v4-pro',input:1.32,output:3.96},{provider:'gemini',model:'gemini-3.1-pro-preview',input:2.00,output:12.00}]:[])];
  const cap=512;
  const reserve=cases.reduce((sum,c)=>sum+(c.input+c.output)*cap/1e6*(c.provider==='deepseek'?2:1),0);
  const plan={mode:extended?'all four unique models':'two fast-tier models',requests:cases.length,maxRequestsWithAdapterRetry:cases.filter(c=>c.provider==='deepseek').length*2+cases.filter(c=>c.provider==='gemini').length,maxOutputTokensPerRequest:cap,conservativeInputTokensPerRequest:cap,estimatedCeilingUsd:reserve,models:cases.map(c=>c.model),paidRequestsMade:0};
  if(!process.argv.includes('--execute')) {console.log(JSON.stringify(plan,null,2));return;}
  const approved=Number(process.argv.find(v=>v.startsWith('--budget-approved-usd='))?.split('=')[1]);
  if(!Number.isFinite(approved)||approved<0.05)throw Error('Explicit human budget authorisation of at least USD 0.05 is required; see docs/LIVE_PROVIDER_TEST.md.');
  const keys={deepseek:process.env.NAUTEX_RELEASE_TEST_DEEPSEEK_KEY,gemini:process.env.NAUTEX_RELEASE_TEST_GEMINI_KEY};
  if(!keys.deepseek||!keys.gemini)throw Error('Provide dedicated test keys in the documented process environment variables.');
  const directory=await mkdtemp(path.join(os.tmpdir(),'nautex-release-test-live-'));
  process.env.NAUTEX_DATA_DIR=directory;
  process.env.DATABASE_URL='postgresql://synthetic:synthetic@127.0.0.1:1/nautex_live_test';
  for(const key of ['AI_PROVIDER','DEEPSEEK_API_KEY','GEMINI_API_KEY','AI_DEFAULT_MODEL','AI_FAST_MODEL','AI_REASONING_MODEL'])delete process.env[key];
  const {generateJSON}=await import('../lib/ai/provider');
  const realFetch=globalThis.fetch, usage:unknown[]=[], results:unknown[]=[];
  let requests=0,reserved=0,current=cases[0];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(!['https://api.deepseek.com','https://generativelanguage.googleapis.com'].includes(url.origin))throw Error('Unexpected test destination blocked');
    const price=(current.input+current.output)*cap/1e6;
    if(requests>=plan.maxRequestsWithAdapterRetry||reserved+price>Math.min(approved,0.05))throw Error('Request/budget limit reached');
    requests++;reserved+=price;
    const response=await realFetch(input,init);
    const json=await response.clone().json().catch(()=>null) as any;
    usage.push({provider:current.provider,model:current.model,status:response.status,usage:json?.usage??json?.usageMetadata??null});
    return response;
  };
  try {
    for(const c of cases){
      current=c;
      const result=await generateJSON<{quantity:number;unit:string}>('Return JSON only: {"quantity":2,"unit":"EA"}. This is fictional test data.',{
        systemInstruction:'Extract only the stated fields. Return a JSON object.',maxTokens:cap,temperature:1,
        reasoning:c.provider==='deepseek'?'disabled':'low',
      },{provider:c.provider as 'deepseek'|'gemini',deepseekApiKey:keys.deepseek,geminiApiKey:keys.gemini,deepseekBaseUrl:'https://api.deepseek.com',defaultModel:c.model,fastModel:c.model,reasoningModel:c.model,vertexProject:null,vertexLocation:null});
      const passed=result.ok&&result.data?.quantity===2&&result.data?.unit==='EA';
      results.push({provider:c.provider,model:c.model,passed,error:result.ok?null:result.error});
      if(!passed)break; // no operator retries or provider/model substitutions
    }
  }finally{globalThis.fetch=realFetch;}
  const record={...plan,paidRequestsMade:requests,reservedCeilingUsd:reserved,results,usage};
  await writeFile(path.join(directory,'live-provider-result.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify(record,null,2));
  if(results.length!==cases.length||results.some(result=>!(result as {passed:boolean}).passed))process.exitCode=1;
}
main().catch(()=>{console.error('Live test stopped. Check the documented authorisation, dedicated keys and model access; no credentials or raw response bodies are printed.');process.exitCode=1;});
