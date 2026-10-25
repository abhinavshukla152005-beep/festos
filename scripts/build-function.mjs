import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'deploy', 'qoder', 'function');

await fs.mkdir(out, { recursive: true });
for (const file of [
  'index.ts',
  'agent.js',
  'qloo.js',
  'planner.js',
  'demo.js',
  'paypal.js',
  'settlement.js',
]) {
  await fs.copyFile(path.join(root, 'server', file), path.join(out, file));
}
console.log(`Qoder function package ready: ${out}`);
