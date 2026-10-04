import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('isolated credentials, provider requests and catalogue schema', async (t) => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'nautex-release-test-unit-'));
  const previous={...process.env}; const originalFetch=globalThis.fetch;
  process.env.NAUTEX_DATA_DIR=directory;
  process.env.BETTER_AUTH_SECRET='Synthetic-unit-test-secret-not-for-production-use';
  process.env.DATABASE_URL='postgresql://synthetic:synthetic@127.0.0.1:1/synthetic';
  for(const key of ['AI_PROVIDER','DEEPSEEK_API_KEY','GEMINI_API_KEY','VERTEX_PROJECT','AI_DEFAULT_MODEL','AI_FAST_MODEL','AI_REASONING_MODEL']) delete process.env[key];
  const store=await import('../lib/ai/secret-store');
  const config=await import('../lib/ai/config');
  const provider=await import('../lib/ai/provider');
  const {transformImpaRow}=await import('../lib/datasets/impa');
  let calls=0;
  try {
    await t.test('empty profile makes zero paid requests',async()=>{
      globalThis.fetch=async()=>{calls++;throw Error('Unexpected network');};
      assert.equal(config.isAIConfigured(),false);
      const result=await provider.generateText('Synthetic input');
      assert.equal(result.ok,false);assert.match(result.error!,/not configured/);assert.equal(calls,0);
    });
    await t.test('credential storage is encrypted and models survive reread',async()=>{
      store.writeAISettings({activeProvider:'deepseek',providers:{deepseek:{apiKey:'synthetic-deepseek-key-for-offline-tests',models:{default:'deepseek-flash',fast:'deepseek-flash',reasoning:'deepseek-v4-pro'}},gemini:{apiKey:'synthetic-gemini-key-for-offline-tests'}}});
      const contents=await readFile(path.join(directory,'ai-settings.enc'));
      assert.equal(contents.includes(Buffer.from('synthetic-deepseek-key')),false);
      assert.equal(config.getAIConfig().defaultModel,'deepseek-flash');
      assert.equal(config.getAIConfig().provider,'deepseek');
    });
    await t.test('both implemented adapters and connection checks use expected shape',async()=>{
      const seen:{url:string;body:Record<string,unknown>}[]=[];
      globalThis.fetch=async(input,init)=>{
        const url=String(input);seen.push({url,body:JSON.parse(String(init?.body))});
        const data=url.includes('deepseek')?{choices:[{finish_reason:'stop',message:{content:'{"status":"ok"}'}}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{"status":"ok"}'}]}}]};
        return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
      };
      for(const p of ['deepseek','gemini'] as const){const result=await provider.testAIConnection(p);assert.equal(result.ok,true);}
      assert.match(seen[0].url,/api.deepseek.com\/chat\/completions/);
      assert.match(seen[1].url,/generativelanguage.googleapis.com/);
      assert.equal(seen[0].body.model,'deepseek-flash');
      assert.equal(config.getAIConfig().provider,'deepseek','testing another provider must not activate it');
    });
    await t.test('authentication, billing, model and service failures are redacted',async()=>{
      for(const status of [401,403,402,429,404,500]){
        globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'SENSITIVE_SERVER_ECHO'}}),{status});
        const result=await provider.generateText('Retain my input');
        assert.equal(result.ok,false);assert.match(result.error!,new RegExp(String(status)));
        assert.equal(result.error!.includes('SENSITIVE_SERVER_ECHO'),false);
        assert.match(result.error!,/input is retained/);
      }
    });
    await t.test('timeout is bounded and recoverable; no raw error escapes',async()=>{
      globalThis.fetch=async()=>{throw new DOMException('secret echoed by transport','TimeoutError');};
      const result=await provider.generateText('Synthetic retained draft');
      assert.equal(result.ok,false);assert.match(result.error!,/timed out/);assert.equal(result.error!.includes('secret echoed'),false);
    });
    await t.test('disconnect does not activate a second stored key',()=>{
      store.writeAISettings({activeProvider:'none',providers:{gemini:{apiKey:'synthetic-gemini-key-for-offline-tests'}}});
      assert.equal(config.getAIConfig().provider,'none');
      store.clearAISettings();assert.deepEqual(store.readAISettings().providers,{});
    });
    await t.test('synthetic catalogue schema and empty rows',()=>{
      const row=transformImpaRow({impaCode:'999998',description:'FICTIONAL release-test widget; not catalogue data',unit:'EA',category:'Synthetic only'});
      assert.equal(row?.description,'FICTIONAL release-test widget; not catalogue data');
      assert.equal(row?.category,'99 - Synthetic only');
      assert.equal(transformImpaRow({impaCode:'',description:''}),null);
    });
    await t.test('credential writes fail closed without workspace secret',()=>{
      delete process.env.BETTER_AUTH_SECRET;
      assert.throws(()=>store.writeAISettings({activeProvider:'none'}),/secure workspace secret/);
    });
  } finally {
    globalThis.fetch=originalFetch;
    for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];
    Object.assign(process.env,previous);
    await rm(directory,{recursive:true,force:true});
  }
});
