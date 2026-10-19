// One fresh Node process per input/mode, not an isolated throughput benchmark.
// node resources.mjs CURRENT_ROOT OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [root, output] = process.argv.slice(2);
if (!output) throw Error('Supply CURRENT_ROOT OUTPUT');
const worker = `
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [mode,file,root]=process.argv.slice(1);
const api=await import(pathToFileURL(root+'/dist/'+(mode==='parsed'?'javascript.js':'index.js')));
const source=readFileSync(file,'utf8');
const start=performance.now();
const result=mode==='parsed'?api.scanJavaScript(source):api.scanText(source,{isCode:true});
console.log(JSON.stringify({mode,bytes:Buffer.byteLength(source),codeUnits:source.length,
  findings:result.findings.length,elapsedMs:performance.now()-start,
  maxRssKiB:process.resourceUsage().maxRSS,node:process.version}));
`;
const rows = [];
for (const file of ['studies/javascript-names/fixtures/latin-cyrillic-a-fixed.mjs', 'node_modules/typescript/lib/typescript.js']) {
  const path = resolve(root, file);
  for (const mode of ['raw', 'parsed']) {
    const processResult = spawnSync(process.execPath, ['--input-type=module', '-e', worker, mode, path, resolve(root)], { encoding: 'utf8' });
    assert.equal(processResult.status, 0, processResult.stderr);
    rows.push({ ...JSON.parse(processResult.stdout), file,
      inputSha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
  }
}
writeFileSync(output, JSON.stringify({
  scope: 'One fresh process per mode/input on the 14-vCPU, 48-GB WSL2 host while fixed inference jobs run; not isolated throughput. RSS includes interpreter, imports and source buffers.',
  runs: rows,
}, null, 2) + '\n');
console.log(JSON.stringify(rows));
