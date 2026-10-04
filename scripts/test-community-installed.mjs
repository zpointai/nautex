import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const executable=process.argv[2] === '--development' ? require('electron') : path.resolve(process.argv[2] || '');
const base=path.resolve(process.argv[3] || '');
if(!process.argv[3] || !path.isAbsolute(process.argv[3]))throw Error('Pass an explicit isolated absolute test directory');
try{await access(base);throw Error('Test directory must not already exist');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(base,{recursive:true});
const profile=path.join(base,'nautex-release-test-profile');
const results=[];let application;
async function launch(){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 for(const k of Object.keys(env))if(/(?:API_KEY|SECRET|TOKEN|NAUTEX_DESKTOP)/.test(k))delete env[k];
 application=await electron.launch({executablePath:executable,args:[...(process.argv[2]==='--development'?['desktop']:[]),`--nautex-test-profile=${profile}`],cwd:process.cwd(),env,timeout:180000});
 const page=await application.firstWindow({timeout:180000});
 await page.context().route(/^https?:\/\//,route=>route.abort());
 page.setDefaultTimeout(45000);
 return page;
}
async function api(page,url,body,method){return page.evaluate(async({url,body,method})=>{const r=await fetch(url,{method:method ?? (body?'POST':'GET'),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{url,body,method});}
try {
 let page=await launch();
 await page.getByRole('heading',{name:'Set up Nautex',exact:true}).waitFor();
 await page.screenshot({path:path.join(base,'first-run.png')});
 results.push('Bundled runtime reaches first-run setup in an isolated profile on this host; clean-VM qualification is separate');
 await page.getByLabel('Company name',{exact:true}).fill('Fictional Release Test Workspace');
 await page.getByLabel('Administrator name',{exact:true}).fill('Synthetic Tester');
 await page.getByLabel('Email',{exact:true}).fill('tester@example.invalid');
 await page.getByLabel('Password',{exact:true}).fill('Synthetic-Release-Test-Password-Only');
 await page.getByRole('button',{name:/Create office/}).click();
 await page.getByRole('heading',{name:'Your private workspace is ready'}).waitFor();
 await page.getByRole('button',{name:'Skip and start locally',exact:true}).click();
 results.push('Local account creation, sign-in and skip-optional-setup work');
 const ai=await api(page,'/api/v1/settings/ai');assert.equal(ai.body.data.configured,false);
 for(const endpoint of ['/api/v1/suppliers','/api/v1/purchase-orders','/api/v1/inventory']){
   const response=await api(page,endpoint);assert.equal(response.status,200,endpoint);assert.deepEqual(response.body.data,[],endpoint+' must start empty');
 }
 const catalogue=await api(page,'/api/v1/impa/catalogue');assert.equal(catalogue.status,200);assert.equal(catalogue.body.data.length,0);
 results.push('No initial provider, suppliers, purchase orders, inventory or catalogue rows');
 const pricing=await api(page,'/api/v1/price-calculator/calculate',{input:{supplierUnitCost:100,quantity:2,markupPct:20}});
 assert.equal(pricing.status,200);assert.equal(pricing.body.data.result.sellTotalPrice,240);assert.equal(pricing.body.data.auditMetadata.aiAssisted,false);
 const rfq=await api(page,'/api/v1/rfq/process',{text:'Description,Quantity,Unit\nFICTIONAL test widget,2,EA',forceFallback:true});
 assert.equal(rfq.status,200);assert.equal(rfq.body.data._fallback,true);
 const validation=await api(page,'/api/v1/procurement/validate',{leftText:'Description,Quantity,Unit,Price\nFICTIONAL test widget,2,EA,100',rightText:'Description,Quantity,Unit,Price\nFICTIONAL test widget,2,EA,100'});
 assert.equal(validation.status,200);assert.equal(validation.body.data._stub,false);assert.equal(validation.body.data._ai.enabled,false);
 results.push('Price arithmetic, structured RFQ processing and rule validation work without provider keys or catalogue');
 const legal=await page.evaluate(async()=>({licence:await (await fetch('/legal/LICENSE.txt')).text(),source:Array.from(new Uint8Array(await (await fetch('/legal/source.zip')).arrayBuffer()).slice(0,2)),template:await (await fetch('/templates/catalogue.csv')).text()}));
 assert.ok(legal.licence.includes('GNU AFFERO GENERAL PUBLIC LICENSE'));assert.deepEqual(legal.source,[80,75]);assert.equal(legal.template.trim().split('\n').length,1);
 results.push('Bundled full licence, source ZIP and empty import template are accessible');
 await page.evaluate(()=>{location.hash='#module=impaSearch';});
 // Navigate using the observed sidebar label rather than relying on hash syntax.
 const catalogueButton=page.getByRole('button',{name:'IMPA Catalogue',exact:false}).first();
 if(await catalogueButton.count())await catalogueButton.click();
 await page.getByText('No catalogue imported',{exact:true}).waitFor();
 await page.screenshot({path:path.join(base,'empty-catalogue.png')});
 const imported=await page.evaluate(async()=>{const form=new FormData();form.append('file',new File(['impaCode,description,unit,category\n999998,FICTIONAL release-test widget not catalogue data,EA,Synthetic\n'],'synthetic.csv',{type:'text/csv'}));const r=await fetch('/api/v1/impa/import',{method:'POST',body:form});return {status:r.status,body:await r.json()};});
 assert.equal(imported.status,200);assert.equal(imported.body.data.importedCount,1);
 const search=await api(page,'/api/v1/catalog/search?q=FICTIONAL');assert.equal(search.status,200);assert.ok(search.body.data.length>=1);
 results.push('Schema-valid synthetic catalogue import and local Item Search work without AI');
 for(const provider of ['deepseek','gemini']){
   const saved=await api(page,'/api/v1/settings/ai',{provider,apiKey:'synthetic-offline-key-never-send-'+provider},'PUT');assert.equal(saved.status,200);
 }
 const modelSave=await api(page,'/api/v1/settings/ai',{provider:'gemini',models:{default:'gemini-3.1-pro-preview',fast:'gemini-3-flash-preview',reasoning:'gemini-3.1-pro-preview'}},'PUT');assert.equal(modelSave.status,200);
 const removed=await api(page,'/api/v1/settings/ai',{provider:'gemini',action:'disconnect'},'PUT');assert.equal(removed.status,200);assert.equal(removed.body.data.activeProvider,'none');
 const stored=await readFile(path.join(profile,'data','ai-settings.enc'));assert.equal(stored.includes(Buffer.from('synthetic-offline-key')),false);
 results.push('Provider save/removal uses encrypted storage; active disconnect does not switch to a retained provider');
 await api(page,'/api/v1/settings/ai',{provider:'deepseek',action:'disconnect'},'PUT');
 // Map regression: new original Leaflet bindings preserve markers/zoom and offline feedback.
 await page.getByRole('button',{name:'Fleet Tracking',exact:false}).first().click();
 await page.locator('.leaflet-container').first().waitFor();
 await page.locator('.leaflet-marker-icon').first().waitFor();
 assert.ok(await page.locator('.leaflet-control-zoom').count());
 await page.screenshot({path:path.join(base,'fleet-map-offline.png')});
 results.push('Fleet map mounts with markers and zoom controls using replacement Leaflet bindings');
 await application.close();application=null;
 page=await launch();
 const signIn=page.getByRole('button',{name:/Sign in/});
 if(await signIn.isVisible().catch(()=>false)){
   await page.getByLabel('Email',{exact:true}).fill('tester@example.invalid');
   await page.getByLabel('Password',{exact:true}).fill('Synthetic-Release-Test-Password-Only');
   await signIn.click();
 }
 await page.waitForFunction(async()=>{try{return (await fetch('/api/v1/auth/context')).ok;}catch{return false;}});
 const persisted=await api(page,'/api/v1/impa/catalogue');assert.equal(persisted.body.data.length,1);
 const afterRestart=await api(page,'/api/v1/settings/ai');assert.equal(afterRestart.body.data.configured,false);
 results.push('Graceful shutdown and restart preserve only synthetic test data; removed provider keys remain absent');
 await application.close();application=null;
 await writeFile(path.join(base,'validation.json'),JSON.stringify({passed:true,results,providerChecks:'offline mock/unit; no live paid calls',profile},null,2));
 console.log(JSON.stringify({passed:true,results},null,2));
} catch(error){
 await writeFile(path.join(base,'validation.json'),JSON.stringify({passed:false,results,error:String(error)},null,2));
 if(application){try{const page=await application.firstWindow();await page.screenshot({path:path.join(base,'failure.png')});}catch{}}
 throw error;
} finally {if(application)await application.close().catch(()=>{});}
