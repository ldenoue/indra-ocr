# Indra OCR browser test

This prototype verifies the released ONNX files with ONNX Runtime Web and runs
image or PDF OCR locally in a browser. PDF.js is loaded from a pinned jsDelivr
CDN URL, while the selected PDF bytes and OCR outputs remain local. It currently
covers PDF page rendering, orientation, line detection, Latin/CJK routing and
recognition, learned reading order, color-coded layout blocks, and semantic
Markdown, rendered HTML, and plain-text output in a two-card viewer. Optional
math classification and attention-decoder models emit inline/display LaTeX;
pinned KaTeX renders HTML plus accessible MathML. The layout
classes are `Text`, `Section-Header`, `Page-Header`, `Page-Footer`, `List-Group`,
`Table`, `Caption`, `Footnote`, `Table-Of-Contents`, and `Form`. Full PDF
text-layer extraction, deskewing, and some of Python's advanced layout and table
post-processing are not yet ported.

## Run

From this directory:

```bash
npm install
npm run download-models
npm run serve
```

The download includes Indra's optional math classifier, encoder, and decoder
(about 20 MB in addition to the core models). Uncheck **Math OCR** to skip loading
and running them for documents that do not need LaTeX extraction.

Open <http://127.0.0.1:8767/>. Choose or drop an image/PDF. PDFs are rendered at
approximately 200 DPI, displayed with previous/next page controls, and processed
page by page. Use **Run graph tests** for the
synthetic tensor compatibility test. Use **Load sample**, then **Run OCR**, for an
end-to-end image test, or **Load 2-page PDF** for PDF rendering and multipage OCR.
Use **Load math PDF** to compare the same one-page layout with Math OCR on and
off; its boxes and reading order should be identical. Both WASM and
WebGPU-with-WASM-fallback can be selected.

The server adds COOP/COEP headers so ONNX Runtime Web can use multithreaded WASM.
Model files are downloaded into `models/`, which Git ignores.

For a quick non-browser WASM graph check after downloading the models:

```bash
npm test
```
