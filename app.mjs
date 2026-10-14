import * as ort from './node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs';
import {IndraBrowserOCR, LAYOUT_CLASSES, canvasToGray, putGray} from './ocr.mjs';
import {blocksToMarkdown, renderMarkdown} from './markdown.mjs';
import {smokeSpecs} from './smoke-specs.mjs';

const PDFJS_VERSION = '6.4.299';
const PDFJS_ROOT = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDF_DPI = 200;
const MAX_PDF_SIDE = 3600;
const $ = selector => document.querySelector(selector);
let pages = [], currentPage = 0, pdfjsPromise = null, activePdfTask = null;
let outputMode = localStorage.getItem('indra-output-mode') || 'md';
let outputContent = {markdown: 'Run OCR to see the Markdown source.', text: 'Run OCR to see recognized text.'};
const LAYOUT_COLORS = {
  'Text': '#2563eb', 'Section-Header': '#7c3aed', 'Page-Header': '#64748b',
  'Page-Footer': '#475569', 'List-Group': '#0f766e', 'Table': '#dc2626',
  'Caption': '#d97706', 'Footnote': '#9333ea', 'Table-Of-Contents': '#0891b2',
  'Form': '#16a34a',
};

ort.env.wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
const status = message => { $('#status').textContent = message; };
const diagnostic = message => { $('#diagnostics').textContent += `${message}\n`; };

function showOutput(mode) {
  if (!['md', 'html', 'text'].includes(mode)) mode = 'md';
  outputMode = mode; localStorage.setItem('indra-output-mode', mode);
  document.querySelectorAll('[data-output]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.output === mode));
  });
  const html = mode === 'html';
  $('#output-title').textContent = mode === 'md' ? 'Markdown' : mode === 'html' ? 'Rendered HTML' : 'Plain text';
  $('#output-source').hidden = html;
  $('#output-html').hidden = !html;
  if (!html) $('#output-source').textContent = mode === 'md' ? outputContent.markdown : outputContent.text;
}

document.querySelectorAll('[data-output]').forEach(button => {
  button.addEventListener('click', () => showOutput(button.dataset.output));
});

for (const label of LAYOUT_CLASSES) {
  const item = document.createElement('span'), color = document.createElement('i');
  color.style.background = LAYOUT_COLORS[label]; item.append(color, label); $('#legend').append(item);
}

function newPageCanvas(label) {
  const section = document.createElement('section'); section.className = 'page';
  const heading = document.createElement('h3'); heading.textContent = label;
  const canvas = document.createElement('canvas');
  section.append(heading, canvas); $('#pages').append(section);
  return {section, canvas, source: document.createElement('canvas'), label};
}

function showPage(index) {
  if (!pages.length) return;
  currentPage = Math.min(Math.max(0, index), pages.length - 1);
  pages.forEach((page, pageIndex) => { page.section.hidden = pageIndex !== currentPage; });
  $('#pager').hidden = pages.length < 2;
  $('#page-indicator').textContent = `Page ${currentPage + 1} of ${pages.length}`;
  $('#previous-page').disabled = currentPage === 0;
  $('#next-page').disabled = currentPage === pages.length - 1;
  $('#pages').scrollTop = 0;
}

function snapshotPage(page) {
  page.source.width = page.canvas.width; page.source.height = page.canvas.height;
  page.source.getContext('2d').drawImage(page.canvas, 0, 0);
}

function restorePage(page) {
  page.canvas.width = page.source.width; page.canvas.height = page.source.height;
  page.canvas.getContext('2d').drawImage(page.source, 0, 0);
}

async function clearPages() {
  if (activePdfTask) { await activePdfTask.destroy().catch(() => {}); activePdfTask = null; }
  pages = []; currentPage = 0; $('#pages').replaceChildren(); $('#pager').hidden = true;
  outputContent = {markdown: 'Run OCR to see the Markdown source.', text: 'Run OCR to see recognized text.'};
  $('#output-html').innerHTML = '<p>Run OCR to see the document.</p>'; showOutput(outputMode);
  $('#run').disabled = true; $('#diagnostics').textContent = '';
}

async function loadPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = import(`${PDFJS_ROOT}/build/pdf.mjs`).then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ROOT}/build/pdf.worker.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

async function showImage(file) {
  await clearPages(); status(`Decoding ${file.name || 'image'}…`);
  const bitmap = await createImageBitmap(file);
  const page = newPageCanvas(file.name || 'Image');
  page.canvas.width = bitmap.width; page.canvas.height = bitmap.height;
  page.canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
  snapshotPage(page); pages = [page]; $('#run').disabled = false;
  showPage(0);
  status(`${page.canvas.width}×${page.canvas.height} image ready`);
}

async function showPdf(file) {
  await clearPages(); status(`Loading PDF.js ${PDFJS_VERSION} from CDN…`);
  const pdfjs = await loadPdfJs();
  activePdfTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${PDFJS_ROOT}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ROOT}/standard_fonts/`,
    wasmUrl: `${PDFJS_ROOT}/wasm/`,
    useSystemFonts: true,
  });
  const pdf = await activePdfTask.promise;
  status(`Rendering ${pdf.numPages} PDF page${pdf.numPages === 1 ? '' : 's'}…`);
  for (let number = 1; number <= pdf.numPages; number++) {
    const sourcePage = await pdf.getPage(number);
    const at72 = sourcePage.getViewport({scale: 1});
    const scale = Math.min(PDF_DPI / 72, MAX_PDF_SIDE / Math.max(at72.width, at72.height));
    const viewport = sourcePage.getViewport({scale});
    const page = newPageCanvas(`Page ${number} of ${pdf.numPages}`);
    page.canvas.width = Math.ceil(viewport.width); page.canvas.height = Math.ceil(viewport.height);
    await sourcePage.render({canvasContext: page.canvas.getContext('2d'), viewport}).promise;
    snapshotPage(page); pages.push(page); sourcePage.cleanup();
    status(`Rendered page ${number} of ${pdf.numPages}`);
  }
  showPage(0);
  $('#run').disabled = false;
  status(`${pdf.numPages}-page PDF ready at approximately ${PDF_DPI} DPI`);
}

async function showFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
  try { await (isPdf ? showPdf(file) : showImage(file)); }
  catch (error) { diagnostic(error.stack || error); status(`Could not open file: ${error.message}`); }
}

$('#file').addEventListener('change', event => showFile(event.target.files[0]));
$('#previous-page').addEventListener('click', () => showPage(currentPage - 1));
$('#next-page').addEventListener('click', () => showPage(currentPage + 1));

$('#sample').addEventListener('click', async () => {
  const response = await fetch('/tests/browser/sample.svg.png');
  await showImage(new File([await response.blob()], 'browser-ocr-sample.png', {type: 'image/png'}));
});

$('#pdf-sample').addEventListener('click', async () => {
  const response = await fetch('/tests/browser/sample.pdf');
  await showPdf(new File([await response.blob()], 'browser-ocr-sample.pdf', {type: 'application/pdf'}));
});

$('#math-sample').addEventListener('click', async () => {
  const response = await fetch('/tests/browser/math-sample.pdf');
  await showPdf(new File([await response.blob()], 'huang-degree-theorem.pdf', {type: 'application/pdf'}));
});

for (const eventName of ['dragenter', 'dragover']) document.addEventListener(eventName, event => {
  event.preventDefault(); document.body.classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) document.addEventListener(eventName, event => {
  event.preventDefault();
  if (eventName === 'drop' || event.relatedTarget === null) document.body.classList.remove('dragging');
});
document.addEventListener('drop', event => showFile(event.dataTransfer.files[0]));

$('#smoke').addEventListener('click', async () => {
  $('#diagnostics').textContent = '';
  const provider = $('#provider').value;
  const eps = provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  try {
    for (const [name, feeds] of Object.entries(smokeSpecs(ort))) {
      status(`Testing ${name}…`);
      const started = performance.now();
      const session = await ort.InferenceSession.create(`/tests/browser/models/${name}`, {executionProviders: eps});
      const output = await session.run(feeds());
      diagnostic(`${name}: PASS (${Math.round(performance.now() - started)} ms) ${Object.values(output).map(v => `[${v.dims}]`).join(' ')}`);
      await session.release();
    }
    diagnostic('PASS'); status('All graph tests passed');
  } catch (error) { diagnostic(error.stack || error); status('Graph tests failed'); }
});

$('#run').addEventListener('click', async () => {
  $('#run').disabled = true; $('#diagnostics').textContent = '';
  const markdownPages = [], textPages = [], layoutPages = [], provider = $('#provider').value;
  try {
    const engine = new IndraBrowserOCR(ort, provider, message => status(message), $('#math').checked);
    await engine.load();
    const totals = {orientation: 0, detection: 0, recognition: 0, math: 0, order: 0, total: 0};
    for (let pageNumber = 0; pageNumber < pages.length; pageNumber++) {
      const page = pages[pageNumber]; restorePage(page);
      status(`Page ${pageNumber + 1}/${pages.length}: preparing image…`);
      const result = await engine.run(canvasToGray(page.canvas), page.canvas.width, page.canvas.height);
      putGray(page.canvas, result.gray, result.width, result.height);
      const context = page.canvas.getContext('2d');
      const thin = Math.max(1, Math.round(Math.max(result.width, result.height) / 1300));
      const thick = Math.max(3, Math.round(Math.max(result.width, result.height) / 550));
      const fontSize = Math.max(13, Math.round(Math.max(result.width, result.height) / 85));
      context.font = `700 ${fontSize}px system-ui`;
      result.order.forEach((index, rank) => {
        const box = result.boxes[index], prediction = result.layout.lines[index];
        context.lineWidth = thin;
        context.strokeStyle = LAYOUT_COLORS[prediction?.label] || '#2563eb';
        context.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      });
      for (const block of result.layout.blocks) {
        const [x0, y0, x1, y1] = block.bbox, color = LAYOUT_COLORS[block.label] || '#111827';
        const label = `${block.label} ${Math.round(block.confidence * 100)}%`;
        context.lineWidth = thick; context.strokeStyle = color;
        context.strokeRect(x0, y0, x1 - x0, y1 - y0);
        const labelWidth = context.measureText(label).width + 10;
        const labelY = y0 >= fontSize + 8 ? y0 - fontSize - 6 : y0 + 2;
        context.fillStyle = color; context.fillRect(x0, labelY, labelWidth, fontSize + 5);
        context.fillStyle = '#fff'; context.fillText(label, x0 + 5, labelY + fontSize);
      }
      // Draw reading order last so block boxes and class labels cannot cover it.
      result.order.forEach((index, rank) => {
        const box = result.boxes[index], value = String(rank + 1);
        const badgePadding = Math.max(4, Math.round(fontSize * 0.3));
        const badgeHeight = fontSize + Math.max(5, Math.round(fontSize * 0.25));
        const badgeWidth = context.measureText(value).width + badgePadding * 2;
        const outsideX = box.x0 - badgeWidth - Math.max(2, thin);
        const badgeX = outsideX >= 0 ? outsideX : Math.min(box.x0, result.width - badgeWidth);
        const badgeY = Math.min(Math.max(0, box.y0), result.height - badgeHeight);
        context.fillStyle = '#111827';
        context.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
        context.fillStyle = '#fff';
        context.fillText(value, badgeX + badgePadding, badgeY + fontSize);
      });
      const markdown = blocksToMarkdown(result.layout.blocks);
      markdownPages.push(pages.length > 1 ? `<!-- Page ${pageNumber + 1} -->\n\n${markdown}` : markdown);
      const text = result.order.map(index => result.readings[index].text).filter(Boolean).join('\n');
      textPages.push(pages.length > 1 ? `Page ${pageNumber + 1}\n\n${text}` : text);
      const debugBlocks = result.layout.blocks.map(block => ({
        label: block.label,
        confidence: Number(block.confidence.toFixed(4)),
        bbox: block.bbox.map(value => Number(value.toFixed(1))),
        lineCount: block.lineIndices.length,
        text: block.text,
      }));
      layoutPages.push({page: pageNumber + 1, blocks: debugBlocks});
      for (const key of Object.keys(totals)) totals[key] += result.timings[key];
      const counts = Object.fromEntries(LAYOUT_CLASSES.map(label => [label, debugBlocks.filter(block => block.label === label).length]).filter(([, count]) => count));
      diagnostic(`Page ${pageNumber + 1}: ${result.boxes.length} lines, ${debugBlocks.length} blocks, ${result.mathLines} math, ${Math.round(result.timings.total)} ms`);
      diagnostic(`Block classes: ${JSON.stringify(counts)}`);
    }
    const markdown = markdownPages.join('\n\n---\n\n');
    outputContent = {markdown, text: textPages.join('\n\n──────────\n\n')};
    await renderMarkdown(markdown, $('#output-html'));
    showOutput(outputMode);
    diagnostic(JSON.stringify({provider, pdfjs: pages.length > 1 ? PDFJS_VERSION : undefined,
      webgpu: Boolean(navigator.gpu), crossOriginIsolated, wasmThreads: ort.env.wasm.numThreads,
      pages: pages.length, layoutClasses: LAYOUT_CLASSES, layoutByPage: layoutPages,
      timingsMs: totals}, null, 2));
    status(`Done: ${pages.length} page${pages.length === 1 ? '' : 's'} in ${Math.round(totals.total)} ms`);
  } catch (error) { diagnostic(error.stack || error); status(error.message); }
  finally { $('#run').disabled = false; }
});

showOutput(outputMode);
if (new URL(location.href).searchParams.get('sample') === '1') $('#sample').click();
