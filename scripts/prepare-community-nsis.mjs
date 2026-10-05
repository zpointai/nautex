import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
const source=path.join(root,'node_modules/app-builder-lib/templates/nsis');
const output=path.join(root,'.desktop-build/nsis-templates');
const expected={
 'include/installer.nsh':'0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0',
 'uninstaller.nsh':'9ee2dac4593478083e8aa6f8487287ce9401006ccd50ecc538871d133ea4a42c'
};
for(const [name,hash] of Object.entries(expected)){
 const actual=createHash('sha256').update(await readFile(path.join(source,name))).digest('hex');
 if(actual!==hash)throw Error('Review required: upstream NSIS template changed: '+name);
}
const files=[];
async function walk(dir,base=''){for(const e of await readdir(dir,{withFileTypes:true})){const f=path.posix.join(base,e.name);if(e.isDirectory())await walk(path.join(dir,e.name),f);else if(/\.(?:ns[hi]|yml|txt|md)$/.test(f))files.push(f);}}
await walk(source);
let replaced=0;
for(const f of files){
 let text=await readFile(path.join(source,f),'utf8');
 text=text.replace(/WinShell::(SetLnkAUMI|UninstShortcut|UninstAppUserModelId)/g,(_,name)=>{replaced++;return '!insertmacro Nautex_'+name;});
 // Resolve every copied template include explicitly; never depend on include search order.
 text=text.replace(/!include\s+(?:"([^"\r\n]+)"|([^\s\r\n]+))/g,(all,a,b)=>{
  const name=(a||b).replaceAll('\\','/');
  const match=[name,'include/'+name].find(n=>files.includes(n));
  return match?'!include "${PROJECT_DIR}\\.desktop-build\\nsis-templates\\'+match.replaceAll('/','\\')+'"':all;
 });
 if(f==='installer.nsi')text='!include "${PROJECT_DIR}\\scripts\\community-shortcuts.nsh"\n'+text;
 await mkdir(path.dirname(path.join(output,f)),{recursive:true});
 await writeFile(path.join(output,f),text);
}
if(replaced!==10)throw Error('Unexpected WinShell call count: '+replaced);
console.log(JSON.stringify({templates:files.length,replacedWinShellCalls:replaced}));
