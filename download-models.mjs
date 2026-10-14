import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'models');
const base = 'https://huggingface.co/datalab-to/indra-ocr/resolve/main';
const files = [
  'det.onnx',
  'orient.onnx',
  'script.onnx',
  'rec.onnx',
  'rec_cjk.onnx',
  'order.onnx',
  'meta.json',
  'mathcls.onnx',
  'math_enc.onnx',
  'math_dec_init.onnx',
  'math_dec_step.onnx',
  'math_meta.json',
];

await mkdir(out, {recursive: true});
for (const name of files) {
  process.stdout.write(`Downloading ${name}... `);
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path.join(out, name), bytes);
  console.log(`${(bytes.byteLength / 1e6).toFixed(2)} MB`);
}
