import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdir,writeFile,access } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [exe,base]=process.argv.slice(2);
assert.ok(path.isAbsolute(exe)&&path.isAbsolute(base));
await mkdir(base,{recursive:false});
const env={...process.env};for(const key of Object.keys(env))if(/API_KEY|SECRET|TOKEN|ELECTRON_RUN_AS_NODE|NAUTEX_DESKTOP/.test(key))delete env[key];
const application=await electron.launch({executablePath:exe,args:[`--nautex-test-profile=${path.join(base,'nautex-release-test-profile')}`],env,timeout:180000});
try{
 const page=await application.firstWindow();
 await page.getByRole('heading',{name:'Set up Nautex',exact:true}).waitFor({timeout:180000});
 const graphics=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=c.height=8;document.body.append(c);
  const gl=c.getContext('webgl');if(!gl)throw Error('WebGL unavailable');
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 a; void main(){gl_Position=vec4(a,0.,1.);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,'precision mediump float; void main(){gl_FragColor=vec4(0.,1.,0.,1.);}'));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,3);const rgba=new Uint8Array(4);gl.readPixels(4,4,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  const debug=gl.getExtension('WEBGL_debug_renderer_info');const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  const c2=document.createElement('canvas'),ctx=c2.getContext('2d');ctx.fillStyle='#123456';ctx.fillRect(0,0,1,1);
  return {shaderPixel:[...rgba],canvasPixel:[...ctx.getImageData(0,0,1,1).data],renderer};
 });
 assert.deepEqual(graphics.shaderPixel,[0,255,0,255]);assert.deepEqual(graphics.canvasPixel,[18,52,86,255]);
 const status=await application.evaluate(({app})=>({features:app.getGPUFeatureStatus(),pids:app.getAppMetrics().map(p=>p.pid)}));
 const output=execFileSync('powershell.exe',['-NoProfile','-Command',`$ids=$env:NAUTEX_GRAPHICS_PIDS -split ','; @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue | ForEach-Object { $_.Modules | Where-Object ModuleName -match '^(d3dcompiler_47|dxcompiler|dxil)\\.dll$' | Select-Object ModuleName,FileName } }) | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,env:{...env,NAUTEX_GRAPHICS_PIDS:status.pids.join(',')}}).trim();
 const result={passed:true,developerHost:true,graphics,features:status.features,shaderModules:output?JSON.parse(output):[]};
 await writeFile(path.join(base,'GRAPHICS.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await application.close();}
