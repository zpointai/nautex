import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Read PE metadata without loading or executing the native module.
export function inspectPE(file) {
  const b=readFileSync(file);
  if(b.toString('ascii',0,2)!=='MZ') return null;
  const pe=b.readUInt32LE(60);
  if(b.toString('ascii',pe,pe+4)!=='PE\0\0') throw Error('Invalid PE signature');
  const sections=b.readUInt16LE(pe+6), optional=pe+24;
  const table=optional+b.readUInt16LE(pe+20);
  const directories=optional+(b.readUInt16LE(optional)===0x20b?112:96);
  const offset=rva=>{
    for(let i=0;i<sections;i++){
      const s=table+i*40, base=b.readUInt32LE(s+12), length=Math.max(b.readUInt32LE(s+8),b.readUInt32LE(s+16));
      if(rva>=base&&rva<base+length)return b.readUInt32LE(s+20)+rva-base;
    }
    return rva;
  };
  const string=p=>b.toString('ascii',p,b.indexOf(0,p));
  const imports=[];
  const rva=b.readUInt32LE(directories+8);
  if(rva)for(let p=offset(rva);p+20<=b.length&&b.readUInt32LE(p+12);p+=20)imports.push(string(offset(b.readUInt32LE(p+12))));
  const exports=[];const exportRva=b.readUInt32LE(directories);
  if(exportRva){const p=offset(exportRva), n=b.readUInt32LE(p+24), names=offset(b.readUInt32LE(p+32));for(let i=0;i<n;i++)exports.push(string(offset(b.readUInt32LE(names+4*i))));}
  return {machine:b.readUInt16LE(pe+4).toString(16),imports:imports.sort(),exports:exports.sort()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(process.argv.slice(2).map(file=>({file,...inspectPE(file)})),null,2));
