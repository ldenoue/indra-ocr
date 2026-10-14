# Browser port vs. Python Indra OCR

This comparison uses Indra OCR `0.3.1`, the local ONNX models in
`tests/browser/models`, and `tests/browser/math-sample.pdf`.

## Reproduce

Create the project-local environment and install the checkout:

```sh
/opt/homebrew/bin/python3.10 -m venv .venv
.venv/bin/pip install -e .
```

Run the official local viewer:

```sh
.venv/bin/indra-ocr-viewer \
  --model-dir tests/browser/models \
  --port 8765 \
  --math
```

Then open <http://127.0.0.1:8765/> and upload
`tests/browser/math-sample.pdf`.

Capture the official Python JSON output without using a temporary folder:

```sh
mkdir -p tests/browser/python-output-ocr tests/browser/python-output-auto

.venv/bin/indra-ocr tests/browser/math-sample.pdf \
  --model-dir tests/browser/models \
  --cores 1 \
  --mode ocr \
  --math \
  --format json \
  --out tests/browser/python-output-ocr \
  --timings

.venv/bin/indra-ocr tests/browser/math-sample.pdf \
  --model-dir tests/browser/models \
  --cores 1 \
  --mode auto \
  --math \
  --format json \
  --out tests/browser/python-output-auto \
  --timings
```

## Observed result

| Pipeline | Lines | Blocks | Notes |
| --- | ---: | ---: | --- |
| Official Python viewer, Auto + Math | 39 | 20 | PDF text-layer validation reports `broken font map`, so it falls back to OCR. |
| Official Python CLI, OCR + Math | 39 | 20 | Same OCR result as the viewer. |
| Browser port, OCR + Math | 37 | 32 | Layout is intentionally frozen before math replacement, so enabling math no longer changes boxes or reading order. |

The official Python result does **not** contain the high-quality display
equations shown by the Datalab/Chandra playground. Several equation-only
regions are empty in Indra's block Markdown, while inline formulas are emitted
as noisy LaTeX such as spaced-out words. The viewer's rendered Preview is
generated from that same Markdown; it is not a second, richer model output.

The generated official outputs (ignored by Git) are:

- `tests/browser/python-output-ocr/math-sample.jsonl`
- `tests/browser/python-output-auto/math-sample.jsonl`

## What the browser port still simplifies

- Deskewing and mapping recognized boxes back through the rotation.
- Gutter cuts and wide-gap line splitting used by Python before recognition.
- Python's full block reading-order decoder; the browser currently uses a
  smaller row-score ordering approximation.
- The table head and table-cell reconstruction path. The browser currently
  falls back to a simple one-column Markdown/HTML table.
- Auto/hybrid PDF text-layer extraction. The browser always rasterizes pages
  through PDF.js and OCRs them.
- Some paragraph, list, furniture, and caption post-processing rules.

Those differences explain the 39-vs-37 line count and 20-vs-32 block count,
but they do not explain the missing polished math: the official Indra Python
pipeline also misses it on this sample.

## Model distinction

Indra is the compact CPU-oriented OCR pipeline whose ONNX graphs we run in the
browser. Chandra OCR 2 is a separate 5B-parameter vision-language model that
generates structured Markdown, HTML, and JSON and is explicitly positioned for
math, tables, complex layouts, and image/diagram extraction. Reproducing the
Chandra playground therefore requires running Chandra (normally on a GPU or
hosted service), not a different renderer for the Indra output.
