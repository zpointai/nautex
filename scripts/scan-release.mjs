// Prints file names and rule identifiers only; never matching secret values.
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const target=process.argv[2] ? path.resolve(process.argv[2]) : root;
const rules=[['provider-key', /(?:sk-[a-zA-Z0-9_-]{24,}|AIza[0-9A-Za-z_-]{30,})/g],['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['credential-url',/(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s:"'<>]+:(?!YOUR_DB_PASSWORD|\$|\{)[^\s@"'<>]{12,}@/g],['owner-path',/C:[\\/]+Users[\\/]+Zlatin[\\/]+(?:Desktop|Downloads|AppData)/gi]];
let files=[];
if(target===root){files=JSON.parse(await readFile(path.join(root,'release-files.json'),'utf8'));}
else {async function walk(d){for(const e of await readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isSymbolicLink())throw Error('Symlink in package');if(e.isDirectory())await walk(p);else files.push(path.relative(target,p));}}await walk(target);}
const exceptions=JSON.parse(await readFile(path.join(root,'third-party/scan-exceptions.json'),'utf8'));
const findings=[];const reviewedFindings=[];let bytes=0;
for(const relative of files){
 const file=path.join(target,relative), info=await lstat(file);if(!info.isFile())throw Error('Non-file '+relative);
 if(/(?:^|[\\/])(?:\.env(?:\..+)?|[^\\/]*\.(?:enc|db|sqlite3?|pfx|p12|dump))$/i.test(relative) && !relative.endsWith('.env.example')) findings.push({file:relative,rule:'private-file'});
 const b=await readFile(file);bytes+=b.length;
 // Scan text and binary strings, including unpacked ASAR. Large binary archives are inspected after extraction separately.
 for(const [rule,re] of rules){re.lastIndex=0;const s=b.toString('utf8');if(re.test(s)){
   const sha256=createHash('sha256').update(b).digest('hex');
   const exception=exceptions.find(e=>e.rule===rule && e.sha256===sha256 && relative.replaceAll('\\','/').endsWith(e.suffix));
   if(exception)reviewedFindings.push({file:relative,rule,sha256,reason:exception.reason});else findings.push({file:relative,rule});
 }}
}
console.log(JSON.stringify({files:files.length,bytes,findings,reviewedFindings},null,2));
if(findings.length)process.exitCode=1;
