import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
const allowed=new Set(JSON.parse(await readFile('release-files.json','utf8')));
const generated=new Set(['public/legal/source.zip','public/legal/THIRD-PARTY-NOTICES.txt','public/images/nautex-logo.png','public/images/nautex-mark.png']);
const forbidden=[];
for(const file of await readdir('.'))if(file.startsWith('.env') && file!=='.env.example')forbidden.push(file);
async function walk(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const relative=directory+'/'+entry.name;
  if(relative==='desktop/node_modules' || relative==='desktop-runtime/node_modules')continue;
  if(entry.isSymbolicLink())throw Error('Build inputs may not contain symlinks: '+relative);
  if(entry.isDirectory())await walk(relative);
  else if(!allowed.has(relative) && !generated.has(relative))forbidden.push(relative);
 }
}
for(const dir of ['app','components','lib','types','desktop','desktop-renderer','desktop-runtime','prisma','public'])await walk(dir);
if(forbidden.length)throw Error('Unreviewed build inputs: '+forbidden.join(', '));
for(const file of allowed)if(!(await lstat(file)).isFile())throw Error('Missing allowlisted source: '+file);
console.log('Build input allowlist verified; no environment file or unreviewed runtime assets.');
