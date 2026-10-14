const MODEL_ROOT = '/tests/browser/models';
const DET_LONG_SIDE = 1024;
const REC_HEIGHT = 32;
const MIN_CONF = 0.5;
const MATH_MIN = 0.5;
const MATH_MIN_CONF = 0.9;
const MATH_EARLY_STOP = 0.8;
const BOS = 1, EOS = 2, N_SPECIAL = 4;
export const LAYOUT_CLASSES = [
  'Text', 'Section-Header', 'Page-Header', 'Page-Footer', 'List-Group',
  'Table', 'Caption', 'Footnote', 'Table-Of-Contents', 'Form',
];

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function resizeGray(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = clamp(Math.floor(fy), 0, sh - 1), y1 = Math.min(y0 + 1, sh - 1);
    const wy = clamp(fy - y0, 0, 1);
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = clamp(Math.floor(fx), 0, sw - 1), x1 = Math.min(x0 + 1, sw - 1);
      const wx = clamp(fx - x0, 0, 1);
      const a = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const b = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[y * dw + x] = Math.round(a * (1 - wy) + b * wy);
    }
  }
  return out;
}

function rotateClockwise(gray, width, height, turns) {
  let src = gray, w = width, h = height;
  for (let turn = 0; turn < turns; turn++) {
    const dst = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      dst[x * h + (h - 1 - y)] = src[y * w + x];
    }
    src = dst;
    [w, h] = [h, w];
  }
  return {gray: src, width: w, height: h};
}

function detectorInput(gray, width, height, longSide = DET_LONG_SIDE) {
  const scale = longSide / Math.max(width, height);
  const rw = Math.max(1, Math.round(width * scale));
  const rh = Math.max(1, Math.round(height * scale));
  const pw = Math.ceil(rw / 32) * 32, ph = Math.ceil(rh / 32) * 32;
  const resized = resizeGray(gray, width, height, rw, rh);
  const ink = new Float32Array(pw * ph);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    ink[y * pw + x] = 1 - resized[y * rw + x] / 255;
  }
  return {ink, width: pw, height: ph, scale};
}

function decodeDetector(data, outWidth, outHeight, scale, pageWidth, pageHeight) {
  const plane = outWidth * outHeight;
  const seen = new Uint8Array(plane);
  const queue = new Int32Array(plane);
  const boxes = [];
  for (let seed = 0; seed < plane; seed++) {
    if (seen[seed] || sigmoid(data[seed]) <= 0.5) continue;
    let head = 0, tail = 0, count = 0, minX = outWidth, maxX = -1;
    let sumTop = 0, sumBottom = 0, sumScore = 0;
    queue[tail++] = seed; seen[seed] = 1;
    while (head < tail) {
      const i = queue[head++], y = Math.floor(i / outWidth), x = i - y * outWidth;
      count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      const cy = (y + 0.5) * 2;
      sumTop += cy - data[plane + i];
      sumBottom += cy + data[2 * plane + i];
      sumScore += sigmoid(data[i]);
      const neighbors = [i - 1, i + 1, i - outWidth, i + outWidth];
      for (let k = 0; k < 4; k++) {
        const n = neighbors[k];
        if (n < 0 || n >= plane || seen[n]) continue;
        const nx = n % outWidth;
        if ((k === 0 || k === 1) && Math.abs(nx - x) !== 1) continue;
        if (sigmoid(data[n]) > 0.5) { seen[n] = 1; queue[tail++] = n; }
      }
    }
    if (count < 2) continue;
    const y0 = sumTop / count, y1 = sumBottom / count;
    const lineHeight = Math.max(1, y1 - y0), expandX = 0.15 * lineHeight;
    boxes.push({
      x0: clamp((minX * 2 - expandX) / scale, 0, pageWidth),
      y0: clamp(y0 / scale, 0, pageHeight),
      x1: clamp(((maxX + 1) * 2 + expandX) / scale, 0, pageWidth),
      y1: clamp(y1 / scale, 0, pageHeight),
      score: sumScore / count,
    });
  }
  return boxes;
}

function cropLine(gray, width, height, box, targetHeight = REC_HEIGHT) {
  const h = Math.max(1, box.y1 - box.y0);
  const ix0 = Math.floor(box.x0 - 0.3 * h), ix1 = Math.ceil(box.x1 + 0.3 * h);
  const iy0 = Math.floor(box.y0 - 0.2 * h), iy1 = Math.ceil(box.y1 + 0.2 * h);
  const cw = Math.max(1, ix1 - ix0), ch = Math.max(1, iy1 - iy0);
  const crop = new Uint8Array(cw * ch); crop.fill(255);
  const sx0 = Math.max(0, ix0), sx1 = Math.min(width, ix1);
  const sy0 = Math.max(0, iy0), sy1 = Math.min(height, iy1);
  for (let y = sy0; y < sy1; y++) {
    crop.set(gray.subarray(y * width + sx0, y * width + sx1), (y - iy0) * cw + sx0 - ix0);
  }
  const outWidth = Math.max(8, Math.min(4096, Math.round(cw * targetHeight / ch)));
  return {pixels: resizeGray(crop, cw, ch, outWidth, targetHeight), width: outWidth, height: targetHeight};
}

function widthBatches(crops, indices, maxBatch = 64, maxRatio = 1.3, maxArea = 64 * 640) {
  const sorted = [...indices].sort((a, b) => crops[a].width - crops[b].width);
  const batches = [];
  for (const i of sorted) {
    const last = batches.at(-1);
    if (last && last.length < maxBatch && Math.max(crops[i].width, 64) <= maxRatio * Math.max(crops[last[0]].width, 64)
      && (last.length + 1) * Math.max(crops[i].width, 64) <= maxArea) last.push(i);
    else batches.push([i]);
  }
  return batches;
}

function batchTensor(ort, crops, indices) {
  const width = Math.ceil(Math.max(...indices.map(i => crops[i].width)) / 8) * 8;
  const cropHeight = crops[indices[0]].height;
  const data = new Float32Array(indices.length * cropHeight * width);
  const widths = new BigInt64Array(indices.length);
  indices.forEach((index, batch) => {
    const crop = crops[index]; widths[batch] = BigInt(crop.width);
    for (let i = 0; i < crop.pixels.length; i++) {
      const y = Math.floor(i / crop.width), x = i - y * crop.width;
      data[(batch * cropHeight + y) * width + x] = 1 - crop.pixels[i] / 255;
    }
  });
  return {
    x: new ort.Tensor('float32', data, [indices.length, 1, cropHeight, width]),
    widths: new ort.Tensor('int64', widths, [indices.length]),
  };
}

function decodeTokens(ids, vocab) {
  return ids.filter(id => id > 0 && id <= vocab.length).map(id => vocab[id - 1]).join('');
}

function detokenizeMath(tokens) {
  const out = [], math = [];
  let inMath = false;
  for (const token of tokens) {
    if (token === '$') {
      if (inMath) { out.push(`$${math.join(' ')}$`); math.length = 0; }
      inMath = !inMath;
    } else if (inMath) math.push(token);
    else out.push(token);
  }
  if (inMath && math.length) out.push(`$${math.join(' ')}$`);
  return out.join('').replace(/\s+/g, ' ').trim();
}

function lineFeatures(boxes, texts, width, height) {
  const hs = boxes.map(b => Math.max(b.y1 - b.y0, 1e-3)).sort((a, b) => a - b);
  const medianH = hs[Math.floor(hs.length / 2)] || 1;
  const out = new Float32Array(boxes.length * 16);
  boxes.forEach((b, i) => {
    const w = Math.max(b.x1 - b.x0, 1e-3), h = Math.max(b.y1 - b.y0, 1e-3), t = texts[i].trim();
    const f = [b.x0 / width, b.y0 / height, b.x1 / width, b.y1 / height,
      (b.x0 + b.x1) / (2 * width), (b.y0 + b.y1) / (2 * height), w / width,
      Math.log(h / medianH), Math.log(w / h) / 4, medianH / height * 20, 0, 0, 0, 0, 0, 0];
    if (t) {
      f[10] = Math.log1p(t.length) / 5;
      f[11] = [...t].filter(c => /[0-9]/.test(c)).length / t.length;
      f[12] = /^[•\-–▪◦*·→]|^\(?\d{1,3}[.)]/.test(t) ? 1 : 0;
      f[13] = t.endsWith('-') ? 1 : 0;
      f[14] = /[.!?:;]$/.test(t) ? 1 : 0;
      f[15] = t[0] !== t[0].toLowerCase() && t[0] === t[0].toUpperCase() ? 1 : 0;
    }
    out.set(f, i * 16);
  });
  return out;
}

function classification(logits) {
  let id = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[id]) id = i;
  const high = logits[id];
  let denominator = 0;
  for (const value of logits) denominator += Math.exp(value - high);
  return {id, label: LAYOUT_CLASSES[id], confidence: 1 / denominator};
}

function layoutPredictions(boxes, readings, order, cls, same) {
  const n = boxes.length, count = LAYOUT_CLASSES.length;
  const lines = boxes.map((box, i) => ({
    ...classification(Array.from(cls.subarray(i * count, (i + 1) * count))),
    bbox: [box.x0, box.y0, box.x1, box.y1],
  }));
  const groups = [];
  for (const index of order) {
    const previous = groups.at(-1)?.at(-1);
    if (previous !== undefined && same[previous * n + index] > 0) groups.at(-1).push(index);
    else groups.push([index]);
  }
  const blocks = groups.map(indices => {
    const logits = new Array(count).fill(0);
    for (const index of indices) for (let c = 0; c < count; c++) logits[c] += cls[index * count + c];
    const predicted = classification(logits);
    return {
      ...predicted,
      bbox: [
        Math.min(...indices.map(i => boxes[i].x0)), Math.min(...indices.map(i => boxes[i].y0)),
        Math.max(...indices.map(i => boxes[i].x1)), Math.max(...indices.map(i => boxes[i].y1)),
      ],
      lineIndices: indices,
      text: indices.map(i => readings[i].text).filter(Boolean).join('\n'),
    };
  });
  return {lines, blocks};
}

export function canvasToGray(canvas) {
  const {data} = canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * data[4*i] + 0.587 * data[4*i+1] + 0.114 * data[4*i+2]);
  return gray;
}

export function putGray(canvas, gray, width, height) {
  canvas.width = width; canvas.height = height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) rgba.set([gray[i], gray[i], gray[i], 255], 4 * i);
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
}

export class IndraBrowserOCR {
  constructor(ort, provider = 'wasm', progress = () => {}, math = true) {
    this.ort = ort; this.provider = provider; this.progress = progress; this.useMath = math;
  }

  async load() {
    this.progress('Loading model metadata…');
    const metaResponse = await fetch(`${MODEL_ROOT}/meta.json`);
    if (!metaResponse.ok) throw new Error('Models not found. Run npm run download-models.');
    const meta = await metaResponse.json();
    this.vocab = JSON.parse(meta.vocab).chars;
    this.vocabCjk = JSON.parse(meta.vocab_cjk).chars;
    const eps = this.provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
    const names = ['det', 'orient', 'script', 'rec', 'rec_cjk', 'order'];
    for (const name of names) {
      this.progress(`Loading ${name}.onnx…`);
      this[name] = await this.ort.InferenceSession.create(`${MODEL_ROOT}/${name}.onnx`, {executionProviders: eps});
    }
    if (this.useMath) {
      this.progress('Loading math OCR models…');
      const mathMeta = await fetch(`${MODEL_ROOT}/math_meta.json`);
      if (!mathMeta.ok) throw new Error('Math models not found. Run npm run download-models.');
      const meta = await mathMeta.json();
      this.mathConfig = meta.config;
      this.mathTokens = ['', '', '', '', ...meta.tokens];
      for (const name of ['mathcls', 'math_enc', 'math_dec_init', 'math_dec_step']) {
        this[name] = await this.ort.InferenceSession.create(`${MODEL_ROOT}/${name}.onnx`, {executionProviders: eps});
      }
    }
  }

  async recognizeMath(gray, width, height, boxes, crops, readings) {
    if (!this.useMath || !boxes.length) return 0;
    this.progress('Finding mathematical lines…');
    const all = crops.map((_, index) => index), selected = [];
    for (const indices of widthBatches(crops, all)) {
      const output = await this.mathcls.run(batchTensor(this.ort, crops, indices));
      indices.forEach((index, batch) => { if (output.p.data[batch] > MATH_MIN) selected.push(index); });
    }
    if (!selected.length) return 0;
    this.progress(`Reading math in ${selected.length} line${selected.length === 1 ? '' : 's'}…`);
    const mathCrops = boxes.map(box => cropLine(gray, width, height, box, this.mathConfig.height));
    let accepted = 0;
    for (const indices of widthBatches(mathCrops, selected, 64, 4, 16 * 64 * 640)) {
      const encoded = await this.math_enc.run(batchTensor(this.ort, mathCrops, indices));
      const cache = await this.math_dec_init.run({memory: encoded.memory});
      const batchSize = indices.length, layers = this.mathConfig.dec_layers;
      const heads = this.mathConfig.dec_heads, headDim = this.mathConfig.channels / heads;
      let selfK = new this.ort.Tensor('float32', new Float32Array(0), [layers, batchSize, heads, 0, headDim]);
      let selfV = selfK;
      let tokens = new this.ort.Tensor('int64', new BigInt64Array(batchSize).fill(BigInt(BOS)), [batchSize]);
      const sequences = Array.from({length: batchSize}, () => []);
      const probabilities = Array.from({length: batchSize}, () => []);
      const done = new Array(batchSize).fill(false);
      for (let position = 0; position < this.mathConfig.max_tokens - 1; position++) {
        const output = await this.math_dec_step.run({
          token: tokens,
          pos: new this.ort.Tensor('int64', new BigInt64Array([BigInt(position)]), []),
          self_k: selfK, self_v: selfV, cross_k: cache.cross_k, cross_v: cache.cross_v,
          mask: encoded.mask,
        });
        selfK = output.new_k; selfV = output.new_v;
        const vocabulary = output.logits.dims[1], next = new BigInt64Array(batchSize);
        for (let batch = 0; batch < batchSize; batch++) {
          let bestId = 0, bestLogit = -Infinity;
          for (let id = 0; id < vocabulary; id++) {
            const value = output.logits.data[batch * vocabulary + id];
            if (value > bestLogit) { bestLogit = value; bestId = id; }
          }
          next[batch] = BigInt(bestId);
          if (done[batch]) continue;
          let denominator = 0;
          for (let id = 0; id < vocabulary; id++) denominator += Math.exp(output.logits.data[batch * vocabulary + id] - bestLogit);
          probabilities[batch].push(1 / denominator);
          const mean = probabilities[batch].reduce((sum, value) => sum + value, 0) / probabilities[batch].length;
          if (bestId === EOS || (probabilities[batch].length >= 8 && mean < MATH_EARLY_STOP)) done[batch] = true;
          else if (bestId >= N_SPECIAL) sequences[batch].push(bestId);
        }
        tokens = new this.ort.Tensor('int64', next, [batchSize]);
        if (done.every(Boolean)) break;
      }
      indices.forEach((index, batch) => {
        const probs = probabilities[batch];
        const confidence = probs.length ? probs.reduce((sum, value) => sum + value, 0) / probs.length : 0;
        const text = detokenizeMath(sequences[batch].map(id => this.mathTokens[id]));
        if (text && confidence >= MATH_MIN_CONF) {
          readings[index] = {text, confidence, math: true}; accepted++;
        }
      });
    }
    return accepted;
  }

  async run(gray, width, height) {
    const timings = {}, mark = name => { timings[name] = performance.now(); };
    mark('start'); this.progress('Checking page orientation…');
    const thumbScale = 768 / Math.max(width, height), tw = Math.round(width * thumbScale), th = Math.round(height * thumbScale);
    const thumb = resizeGray(gray, width, height, tw, th), orientData = new Float32Array(768 * 768);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) orientData[y * 768 + x] = 1 - thumb[y * tw + x] / 255;
    const orient = await this.orient.run({x: new this.ort.Tensor('float32', orientData, [1, 1, 768, 768])});
    let turn = 0, best = -Infinity;
    orient.p.data.forEach((p, i) => { if (p > best) { best = p; turn = i; } });
    if (best <= 0.95) turn = 0;
    if (turn) ({gray, width, height} = rotateClockwise(gray, width, height, turn));
    timings.orientation = performance.now() - timings.start; mark('detStart');

    this.progress('Detecting text lines…');
    const input = detectorInput(gray, width, height);
    const detected = await this.det.run({x: new this.ort.Tensor('float32', input.ink, [1, 1, input.height, input.width])});
    const dims = detected.out.dims;
    const boxes = decodeDetector(detected.out.data, dims[3], dims[2], input.scale, width, height);
    timings.detection = performance.now() - timings.detStart; mark('recStart');

    this.progress(`Recognizing ${boxes.length} lines…`);
    const crops = boxes.map(box => cropLine(gray, width, height, box));
    const all = crops.map((_, i) => i), cjk = new Array(crops.length).fill(false);
    for (const indices of widthBatches(crops, all)) {
      const p = await this.script.run(batchTensor(this.ort, crops, indices));
      indices.forEach((index, k) => { cjk[index] = p.p.data[k] > 0.5; });
    }
    const readings = boxes.map(() => ({text: '', confidence: 0}));
    for (const useCjk of [false, true]) {
      const selected = all.filter(i => cjk[i] === useCjk), session = useCjk ? this.rec_cjk : this.rec;
      const vocab = useCjk ? this.vocabCjk : this.vocab;
      for (const indices of widthBatches(crops, selected)) {
        const output = await session.run(batchTensor(this.ort, crops, indices));
        const steps = output.ids.dims[1];
        indices.forEach((index, k) => {
          const length = Number(output.lengths.data[k]), kept = [], probs = [];
          let previous = -1;
          for (let t = 0; t < length; t++) {
            const id = Number(output.ids.data[k * steps + t]);
            if (id !== 0 && id !== previous) { kept.push(id); probs.push(output.conf.data[k * steps + t]); }
            previous = id;
          }
          const confidence = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
          readings[index] = {text: confidence >= MIN_CONF ? decodeTokens(kept, vocab) : '', confidence};
        });
      }
    }
    timings.recognition = performance.now() - timings.recStart; mark('orderStart');

    let order = all, layout = {lines: [], blocks: []};
    if (boxes.length > 0) {
      const features = lineFeatures(boxes, readings.map(r => r.text), width, height);
      const mask = new Uint8Array(boxes.length); mask.fill(1);
      const output = await this.order.run({
        feats: new this.ort.Tensor('float32', features, [1, boxes.length, 16]),
        mask: new this.ort.Tensor('bool', mask, [1, boxes.length]),
      });
      const logits = output.a.data, n = boxes.length;
      if (n > 1) {
        order = [...all].sort((i, j) => {
          let si = 0, sj = 0;
          for (let k = 0; k < n; k++) { si += logits[i*n+k]; sj += logits[j*n+k]; }
          return sj - si;
        });
      }
      layout = layoutPredictions(boxes, readings, order, output.cls.data, output.same.data);
    }
    timings.order = performance.now() - timings.orderStart; mark('mathStart');

    // Layout is intentionally frozen before math OCR. LaTeX is much longer than
    // the plain OCR reading and would otherwise alter OrderNet's text features,
    // changing block boxes and reading order merely because math is enabled.
    const mathLines = await this.recognizeMath(gray, width, height, boxes, crops, readings);
    for (const block of layout.blocks) {
      block.text = block.lineIndices.map(index => readings[index].text).filter(Boolean).join('\n');
    }
    timings.math = performance.now() - timings.mathStart;
    timings.total = performance.now() - timings.start;
    return {gray, width, height, rotation: 90 * turn, boxes, readings, order, layout, mathLines, timings};
  }
}
