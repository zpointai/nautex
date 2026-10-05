const {readFile,readdir,unlink}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path');
// Windows 11 supplies D3DCompiler_47; Nautex does not use WebGPU/DXC.
// Pins prevent a future Electron upgrade silently changing this packaging decision.
const omitted={
 'd3dcompiler_47.dll':'a05f99734f7c4822fefc12b367af21fd0976ed6608752fb1e1e80b6ece7ecbbb',
 'dxcompiler.dll':'1085707889573af5b32e7644d47a7c5f0809ed0818217d75f6eaedee37a2a767',
 'dxil.dll':'77e039c905030a641e53658a008b74e90635a5ea9b6b79eabd0f2003bdfca59a'
};
module.exports=async context=>{
 if(context.electronPlatformName!=='win32')throw Error('Community packaging is qualified for Windows x64 only');
 const files=await readdir(context.appOutDir);
 for(const [name,expected] of Object.entries(omitted)){
  const actualName=files.find(f=>f.toLowerCase()===name);if(!actualName)throw Error('Review required: missing expected Electron file '+name);
  const file=path.join(context.appOutDir,actualName);
  if(createHash('sha256').update(await readFile(file)).digest('hex')!==expected)throw Error('Review required: Electron shader DLL changed: '+name);
 }
 for(const name of Object.keys(omitted))await unlink(path.join(context.appOutDir,files.find(f=>f.toLowerCase()===name)));
};
