// Syntax-checks the concatenated game script and maps an error back to its source file and line:  node tools/syntax.mjs
import fs from 'fs';
import { spawnSync } from 'child_process';
const files = fs.readdirSync('src').filter((f) => f.endsWith('.js')).sort();
let js = '', map = [];
for (const f of files) { const body = `\n// ---- ${f} ----\n` + fs.readFileSync('src/' + f, 'utf8'); map.push([js.split('\n').length, f]); js += body; }
const tmp = '/tmp/bundle-check.mjs'; fs.writeFileSync(tmp, js);
const r = spawnSync('node', ['--check', tmp], { encoding: 'utf8' });
if (r.status === 0) { console.log('syntax ok (' + files.length + ' modules)'); process.exit(0); }
const m = /bundle-check\.mjs:(\d+)/.exec(r.stderr);
if (m) { const line = +m[1]; let src = map[0]; for (const e of map) if (e[0] <= line) src = e; console.log(`syntax error in src/${src[1]} line ${line - src[0] - 1}:`); }
console.log(r.stderr.split('\n').slice(0, 8).join('\n'));
process.exit(1);
