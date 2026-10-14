import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as ort from 'onnxruntime-web';
import {smokeSpecs} from './smoke-specs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
ort.env.wasm.numThreads = 1;

for (const [name, feeds] of Object.entries(smokeSpecs(ort))) {
  const bytes = await fs.readFile(path.join(here, 'models', name));
  const session = await ort.InferenceSession.create(bytes, {executionProviders: ['wasm']});
  const output = await session.run(feeds());
  console.log(`${name}: ${Object.values(output).map(value => `[${value.dims}]`).join(' ')}`);
  await session.release();
}
console.log('PASS');
