// Read-only source/lock inspection. Writes audit artifacts beside this script.
// --online sends only public package names/versions to npm's advisory API.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS audit script, not application code. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const semver = require('semver');
const root = path.resolve(__dirname, '../..');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const manifest = readJson(path.join(root, 'package.json'));
const parsed = ts.parseConfigFileTextToJson('bun.lock', fs.readFileSync(path.join(root, 'bun.lock'), 'utf8'));
if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, ' '));
const lock = parsed.config;
const norm = p => p.replaceAll('\\', '/');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.[cm]?[jt]sx?$/.test(e.name)) files.push(p);
  }
}
for (const d of ['src', 'scripts', 'prisma', 'tests', 'examples']) walk(path.join(root, d));
for (const f of fs.readdirSync(root)) if (/\.[cm]?[jt]sx?$/.test(f)) files.push(path.join(root, f));
const fileSet = new Set(files);
const refs = new Map();
function resolveLocal(from, spec) {
  const base = spec.startsWith('@/') ? path.join(root, 'src', spec.slice(2)) : path.resolve(path.dirname(from), spec);
  return [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx'].map(x => base + x)].find(x => fileSet.has(x));
}
function pkgName(s) { return s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]; }
for (const file of files) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const entries = [];
  const add = (s, typeOnly) => {
    const spec = s.text;
    if (spec.startsWith('.') || spec.startsWith('@/')) entries.push({ spec, local: resolveLocal(file, spec), typeOnly });
    else if (!spec.startsWith('node:') && !['fs', 'path', 'crypto', 'url', 'module'].includes(spec)) entries.push({ spec, package: pkgName(spec), typeOnly });
  };
  function visit(n) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier, !!n.importClause?.isTypeOnly);
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier, !!n.isTypeOnly);
    if (ts.isCallExpression(n) && n.arguments.length && ts.isStringLiteral(n.arguments[0]) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) add(n.arguments[0], false);
    ts.forEachChild(n, visit);
  }
  visit(sf); refs.set(file, entries);
}
const roots = files.filter(f => norm(path.relative(root, f)).startsWith('src/app/') || norm(path.relative(root, f)) === 'src/instrumentation.ts');
const reachable = new Set();
const queue = [...roots];
while (queue.length) {
  const f = queue.shift(); if (reachable.has(f)) continue; reachable.add(f);
  for (const r of refs.get(f) || []) if (r.local && !r.typeOnly) queue.push(r.local);
}
const declarations = { ...manifest.dependencies, ...manifest.devDependencies };
const direct = Object.entries(declarations).map(([name, declared]) => {
  let installed; try { installed = readJson(path.join(root, 'node_modules', name, 'package.json')); } catch {}
  const locked = lock.packages[name]?.[0]?.slice(name.length + 1) ?? null;
  const imports = [...refs.entries()].flatMap(([f, rs]) => rs.filter(r => r.package === name).map(r => ({ file: norm(path.relative(root, f)), typeOnly: r.typeOnly, reachable: reachable.has(f) && !r.typeOnly })));
  return { name, declared, locked, installed: installed?.version ?? null, license: installed?.license ?? null, scripts: installed?.scripts ? Object.keys(installed.scripts).filter(k => /^(preinstall|install|postinstall)$/.test(k)) : [], kind: manifest.dependencies[name] ? 'dependency' : 'devDependency', reachableImport: imports.some(x => x.reachable), imports };
});
const entries = Object.entries(lock.packages).map(([key, value]) => {
  const at = value[0].lastIndexOf('@');
  return { key, name: value[0].slice(0, at), version: value[0].slice(at + 1), meta: value[2] || {}, integrity: value[3] || null, registry: value[1] || null };
});
const byKey = new Map(entries.map(e => [e.key, e]));
const reverse = new Map();
for (const e of entries) {
  for (const [dep, range] of Object.entries({ ...e.meta.dependencies, ...e.meta.optionalDependencies, ...e.meta.peerDependencies })) {
    let parent = e.key, found;
    while (parent) { const candidate = byKey.get(parent + '/' + dep); if (candidate && semver.valid(candidate.version) && semver.satisfies(candidate.version, range, { includePrerelease: true })) { found = candidate; break; } const i = parent.lastIndexOf('/'); parent = i < 0 ? '' : parent.slice(0, i); }
    found ??= byKey.get(dep);
    if (found) { const list = reverse.get(found.key) || []; list.push(e.key); reverse.set(found.key, list); }
  }
}
function ancestors(key) {
  const seen = new Set(), q = [key];
  while(q.length) { const k = q.shift(); if(seen.has(k)) continue; seen.add(k); for(const p of reverse.get(k) || []) q.push(p); }
  return Object.keys(declarations).filter(n => seen.has(n));
}
const versions = {};
for (const e of entries) { const vs = versions[e.name] ||= []; if (!vs.includes(e.version)) vs.push(e.version); }
const inventory = { generatedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), method: 'Static TS import graph from Next app and instrumentation entry points; type-only edges omitted. CLI/config/plugin references require manual classification. Lock ancestors include installed peer/optional relationships and are conservative, not proof of runtime reachability.', totals: { dependencies: Object.keys(manifest.dependencies).length, devDependencies: Object.keys(manifest.devDependencies).length, lockEntries: entries.length, packageNames: Object.keys(versions).length, sourceFiles: files.length, appReachableFiles: reachable.size }, lockSettings: Object.fromEntries(Object.entries(lock).filter(([k]) => !['packages','workspaces'].includes(k))), direct, entries: entries.map(({meta,...e}) => e), packageVersions: versions };
fs.writeFileSync(path.join(__dirname, 'dependency-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ totals: inventory.totals, reachablePackages: direct.filter(x=>x.reachableImport).map(x=>x.name), noImports: direct.filter(x=>!x.imports.length).map(x=>x.name), orphanOnly: direct.filter(x=>x.imports.length&&!x.reachableImport).map(x=>({name:x.name,files:x.imports.map(i=>i.file)})), drift:direct.filter(x=>x.locked!==x.installed).map(x=>({name:x.name,locked:x.locked,installed:x.installed})) },null,2));
async function online() {
  const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(versions),signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`npm advisory API ${response.status}`);
  const body = await response.json();
  fs.writeFileSync(path.join(__dirname,'npm-advisories-raw.json'),JSON.stringify({checkedAt:new Date().toISOString(),endpoint:'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',advisories:body},null,2)+'\n');
  const findings = [];
  for (const [name, ads] of Object.entries(body)) for (const ad of ads) {
    const affected = entries.filter(e=>e.name===name && semver.valid(e.version) && semver.satisfies(e.version,ad.vulnerable_versions,{includePrerelease:true}));
    if (affected.length) findings.push({...ad,name,affected:affected.map(e=>({key:e.key,version:e.version,directAncestors:ancestors(e.key)}))});
  }
  fs.writeFileSync(path.join(__dirname,'npm-advisories-matched.json'),JSON.stringify({checkedAt:new Date().toISOString(),findings},null,2)+'\n');
  const severity={}; for(const f of findings) severity[f.severity]=(severity[f.severity]||0)+1;
  console.log(JSON.stringify({advisorySummary:severity,findings:findings.map(f=>({name:f.name,severity:f.severity,title:f.title,url:f.url,range:f.vulnerable_versions,versions:[...new Set(f.affected.map(e=>e.version))],ancestors:[...new Set(f.affected.flatMap(e=>e.directAncestors))]}))},null,2));
}
if(process.argv.includes('--online')) online().catch(e=>{console.error(e);process.exitCode=1});
