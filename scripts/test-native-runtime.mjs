import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { childEnvironment } from '../desktop/child-environment.mjs';
import { inspectPE } from './pe-inspect.mjs';
const backend=path.resolve(process.argv[2]||'.desktop-build/backend');
const packages=path.join(backend,'packages');
const probe=await mkdtemp(path.join(os.tmpdir(),'nautex-release-test-native-'));
const dependencies=['sharp','@img/sharp-win32-x64','@img/colour','detect-libc','semver'];
try {
  // Outside the checkout, so Node cannot silently resolve a development dependency.
  for(const dependency of dependencies)await cp(path.join(packages,dependency),path.join(probe,'node_modules',dependency),{recursive:true});
  const code=`const assert=require('node:assert/strict');const path=require('node:path');assert.ok(require.resolve('sharp').startsWith(path.join(process.cwd(),'node_modules')+path.sep));const sharp=require('sharp');sharp({create:{width:8,height:8,channels:4,background:{r:1,g:2,b:3,alpha:1}}}).resize(4,4).png().toBuffer({resolveWithObject:true}).then(({data,info})=>{for(const loaded of Object.keys(require.cache))assert.ok(loaded.startsWith(path.join(process.cwd(),'node_modules')+path.sep));assert.equal(info.width,4);assert.equal(info.height,4);assert.equal(data[0],137);console.log(JSON.stringify({sharp:sharp.versions.sharp,vips:sharp.versions.vips,processing:'PASS',isolated:true}))}).catch(e=>{console.error(e.message);process.exitCode=1});`;
  execFileSync(process.execPath,['-e',code],{cwd:probe,env:{...childEnvironment(),NODE_PATH:''},stdio:'inherit',windowsHide:true});
} finally {
  if(path.dirname(path.resolve(probe))!==path.resolve(os.tmpdir())||!path.basename(probe).startsWith('nautex-release-test-native-'))throw Error('Unsafe native test cleanup');
  await rm(probe,{recursive:true,force:true});
}
const pg=path.resolve('.desktop-build/postgresql');
const bin=await readdir(path.join(pg,'bin'));
if(bin.some(name=>/^wx(?:base|msw).*\.dll$/i.test(name)))throw Error('Unneeded wxWidgets remains');
for(const directory of ['bin','lib'])for(const name of await readdir(path.join(pg,directory))){
  if(!/\.(exe|dll)$/i.test(name))continue;
  const pe=inspectPE(path.join(pg,directory,name));
  if(pe?.imports.some(dll=>/^wx(?:base|msw)/i.test(dll)))throw Error('A retained PostgreSQL binary requires excluded wxWidgets');
}
console.log('PostgreSQL PE import review: no retained module imports the excluded GUI DLLs.');
