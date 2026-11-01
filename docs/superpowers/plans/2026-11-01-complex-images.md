# Complex Image Fidelity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. User authorization permits continuous implementation and verification.

**Goal:** Make detailed artwork and photos trace more faithfully while retaining a compact mode.

**Architecture:** Extend the current raster-to-vector engine, keep opacity separate from overlapping RGB paths, and use explicit job invalidation in the browser. Share trace settings between the app and benchmark.

**Tech Stack:** Vanilla JavaScript, Canvas, Web Workers, SVG, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-01-complex-images-design.md`

## Global Constraints

- No runtime dependencies, uploads, or build step.
- Preserve existing code conversion formats and visual style.
- Follow-up instruction on November 1: commit directly to the existing main branch and GitHub repository using the configured user identity, without Codex attribution. This supersedes the earlier local feature-branch workflow.

## Review Focus

- Very small colored features and single-pixel images must survive.
- Alpha must be applied once even where stacked paths overlap.
- Empty, malformed, nonfinite and oversized inputs must reject before allocating.
- Replacement images and asynchronous worker/reveal callbacks must not show stale output.
- High quality controls must remain usable on narrow screens and worker failures.

### Task 1: Engine fidelity and safety

Files: `tracer.js`, `tests/tracer.test.js`, `package.json`.

- [x] Write and run failing behavior tests for >64 colors, small features, alpha and validation.
- [x] Extend palette sampling, add edge-aware denoising, and preserve alpha with vector masks.
- [x] Run the Node suite and browser rasterization checks; compare opaque fixtures against baseline.

### Task 2: Quality settings and job lifecycle

Files: `trace-settings.js`, `tests/settings.test.js`, `app.js`, `index.html`, `tests/benchmark/bench.html`.

- [x] Write failing tests for bounded working sizes and detailed preset behavior.
- [x] Share presets/options/sizing between app and benchmark. Add detailed preset, resolution and denoising controls.
- [x] Invalidate old jobs on new files/cancel, coalesce settings changes, and use identical SVG composition in preview/export.
- [x] Test replacement/cancel/retrace and exports with real browser workers, including fallback.

### Task 3: Quality evidence and documentation

Files: `tests/benchmark/bench.html`, `README.md`, `tests/browser.test.js`, `tests/benchmark/results.json`.

- [x] Add deterministic detail/transparency fixtures and a repeatable browser regression suite.
- [x] Benchmark old and new presets, recording RMSE, nodes, bytes and timing.
- [x] Document controls, engine options, validation and honest limitations.
- [x] Run all tests, inspect desktop/mobile screenshots and perform independent code review.

## Progress

Baseline verified using the existing browser benchmark. Implementation is authorized by the user's request to do whatever is possible. Work proceeds inline; review uses a fresh reviewer as required by the execution skill.


## Final verification ledger

- Engine tests were written and observed failing for palettes, rare accents, tiny shapes, alpha, malformed input, signed bytes, and noisy alpha bounds, then passed after fixes.
- Browser checks cover real workers, synchronous fallback, quality changes, cancellation, sample/file replacement, delayed decode, mask rendering, premultiplied blur, pinholes, currentColor conversion, Android rejection, responsive studio layout, inspector tabs, palette restore, keyboard dialog and file chooser.
- Two independent reviews ran: engine review found converter/alpha validation issues; whole-change review found stale swatches during replacement decoding. Each has a regression test and a verified correction.
- Measurement runner compares b36b29a with current code using identical fixture data and Chromium. Detailed dog RMSE 19.75 to 5.31; landscape 14.24 to 5.76. Larger output is deliberate and documented.
- Earlier local-only ruling superseded by the user's later instruction to commit directly to main on GitHub. No new branch or PR.

## Zoom finish follow-up

- Reproduced the grain-as-mosaic effect on the user's actual grayscale source at 300% zoom. Texture fidelity alone does not produce a clean vector finish.
- Strong denoising now expands spatial support through 3×3, 5×5, and 7×7 neighborhoods; spatial weights are precomputed. Cleaned tones drive paint as well as label geometry.
- At stronger smoothness, tiny loops receive rounded cubic joins instead of bypassing smoothing. Low smoothness and exact polygon/alpha tracing retain compact original geometry.
- Added an optional Clean finish preset. Detailed remains the automatic fidelity choice, with an explicit texture explanation.
- The actual image changed from 569,552 to 424,090 nodes; the SVG remains genuine paths. Compared the full figure and a 300% crop visually. Cleaning preserves useful contours but simplifies some texture and cannot invent missing source detail.
- Regression checks failed first for inadequate grain reduction, unsmoothed tiny loops, and the missing preset. Then all 25 unit tests and 22 browser tests passed.
- The restarted test server exposed an existing missing CSS MIME type; Chromium rejected the studio stylesheet. Added text/css and reran the full suite successfully.
- Independent read-only review found no actionable issues, including exhaustive checks of all binary 4×4 masks for invalid tiny-loop geometry.
- Ruling: preserve the source palette-layer gradient architecture; disconnected shading remains a documented limitation rather than an untested simultaneous rewrite.
