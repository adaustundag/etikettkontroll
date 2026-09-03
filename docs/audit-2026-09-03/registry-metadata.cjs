// Queries public metadata only; installs or executes no packages.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS audit script, not application code. */
const fs=require('node:fs');
const path=require('node:path');
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'dependency-inventory.json'),'utf8'));
const results=[];
const pending=[...inventory.direct];
async function worker(){while(pending.length){const dep=pending.shift();try{const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(dep.name)}/latest`,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('HTTP '+response.status);const body=await response.json();results.push({name:dep.name,locked:dep.locked,latest:body.version,license:body.license,engines:body.engines,deprecated:body.deprecated??null,repository:body.repository,homepage:body.homepage});}catch(e){results.push({name:dep.name,error:e.message});}}}
Promise.all(Array.from({length:6},worker)).then(()=>{results.sort((a,b)=>a.name.localeCompare(b.name));fs.writeFileSync(path.join(__dirname,'registry-metadata.json'),JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');console.log(JSON.stringify({errors:results.filter(r=>r.error),selected:results.filter(r=>['next','eslint-config-next','react','react-dom','sharp','@prisma/client','prisma','@zxing/browser','eslint','typescript','@tailwindcss/postcss'].includes(r.name)),licenseCounts:results.reduce((o,r)=>{const l=JSON.stringify(r.license);o[l]=(o[l]||0)+1;return o},{})},null,2));}).catch(e=>{console.error(e);process.exitCode=1});
