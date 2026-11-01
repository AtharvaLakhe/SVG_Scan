# Complex Image Fidelity Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. User authorization permits continuous implementation and verification.

**Goal:** Make detailed artwork and photos trace more faithfully while retaining a compact mode.

**Architecture:** Extend the current raster-to-vector engine, keep opacity separate from overlapping RGB paths, and use explicit job invalidation in the browser. Share trace settings between the app and benchmark.

**Tech Stack:** Vanilla JavaScript, Canvas, Web Workers, SVG, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-01-complex-images-design.md`

## Global Constraints

- No runtime dependencies, uploads, or build step.
- Preserve existing code conversion formats and visual style.
- Use a feature branch; no push or deployment in this task.

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
- Ruling: keep the feature branch locally for review. No merge, push, PR, or deployment is required to fulfill local development.
- Ruling: preserve the source palette-layer gradient architecture; disconnected shading remains a documented limitation rather than an untested simultaneous rewrite.
