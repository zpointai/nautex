import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const notices=[]; const packages=[];
for(const prefix of ['', 'desktop', 'desktop-runtime']){
 const lock=JSON.parse(await readFile(path.join(prefix,'package-lock.json'),'utf8'));
 for(const [location,entry] of Object.entries(lock.packages)){
  if(!location || !location.includes('node_modules'))continue;
  const directory=path.join(prefix,location);
  let manifest;try{manifest=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));}catch{continue;}
  const id=manifest.name+'@'+manifest.version;if(packages.some(p=>p.id===id))continue;
  const license=manifest.license ?? entry.license ?? 'UNDECLARED';
  const names=(await readdir(directory)).filter(n=>/^(?:licen[sc]e|copying|notice|copyright)(?:[._-].*)?$/i.test(n));
  const texts=[];for(const name of names){try{texts.push(await readFile(path.join(directory,name),'utf8'));}catch{}}
  packages.push({id,license,source:entry.resolved ?? manifest.repository ?? null,notices:names});
  notices.push('\n===== '+id+' · '+JSON.stringify(license)+' =====\n'+texts.join('\n'));
 }
}
// Native licence texts are deliberately reviewed source inputs, not npm metadata.
const nativeLicences=JSON.parse(await readFile('third-party/licences/index.json','utf8'));
for(const entry of nativeLicences){
 if(!/^[a-zA-Z0-9_.-]+$/.test(entry.file))throw Error('Unsafe native licence filename');
 const body=await readFile(path.join('third-party/licences',entry.file),'utf8');
 notices.push('\n===== Native licence: '+entry.file+' =====\nSource: '+(entry.archive??entry.npmPackage)+' / '+entry.member+'\n'+body);
}
const replacements=JSON.parse(await readFile('third-party/replacements/index.json','utf8'));
for(const entry of replacements){
 if(!/^[a-zA-Z0-9_.\-/]+$/.test(entry.file)||entry.file.split('/').includes('..'))throw Error('Unsafe replacement notice filename');
 const body=await readFile(path.join('third-party/replacements',entry.file),'utf8');
 notices.push('\n===== Source-built replacement notice: '+entry.file+' =====\n'+body);
}
notices.push('\n===== Rust dependency notices =====\n'+await readFile('third-party/rust-notices/NOTICES.txt','utf8'));
await mkdir('public/legal',{recursive:true});
await mkdir('docs',{recursive:true});
await writeFile('public/legal/THIRD-PARTY-NOTICES.txt',notices.join('\n'));
await writeFile('docs/dependency-inventory.json',JSON.stringify(packages,null,2)+'\n');
const review=packages.filter(p=>typeof p.license!=='string'||!/^(MIT|ISC|Apache-2.0|BSD-[23]-Clause|CC0-1.0|Unlicense|0BSD|BlueOak-1.0.0|Python-2.0|CC-BY-4.0|OFL-1.1|\(MIT OR.*\)|\(BSD-2-Clause OR MIT OR Apache-2.0\))$/.test(p.license));
console.log(JSON.stringify({packages:packages.length,requiresReview:review},null,2));
