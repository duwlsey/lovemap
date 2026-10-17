import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/build-server.mjs'], { stdio: 'inherit' });
await mkdir('release', { recursive: true });
await writeFile('release/LoveMap-Code.gs', await readFile('apps-script/production/Code.gs'));
console.log('Ready: release/LoveMap-Code.gs');
