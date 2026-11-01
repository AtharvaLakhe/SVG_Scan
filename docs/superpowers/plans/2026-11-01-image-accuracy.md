# Image Accuracy Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; use a fresh reviewer at the end.

**Goal:** Improve measured and visually inspected tracing accuracy across varied images.

**Architecture:** Retain the dependency-free engine, shared settings and browser app. Fix preparation/fitting/alpha at their existing boundaries and add a repeatable corpus runner.

**Tech Stack:** Vanilla JavaScript, Canvas, SVG, Web Workers, Node test runner, Playwright.

**Spec:** docs/superpowers/specs/2026-11-01-image-accuracy-design.md

## Global constraints

- No runtime dependency, embedded bitmap substitute, or new branch.
- Keep current UI and converters, with clear recommendations and manual alternatives.
- Direct main commit and push using the configured user identity.

## Review focus

- Rare colored marks and translucent palettes survive automatic settings.
- High-contrast curves and fine ink retain coverage at original dimensions.
- Small sources stay native; large sources stay within four million working pixels.
- Alpha has no systematic positive bias, while exact levels and opaque pixels survive.
- Shared recommendation behavior reaches both initial loading and Reset.

### Task 1: Source preparation and automatic recommendations

Files: trace-settings.js, app.js, index.html, tests/settings.test.js, tests/browser/app.spec.js.

- [x] Observe failing tests for native small sizing, exact-palette automatic rendering, translucency analysis, and fine default resolution.
- [x] Implement native bounded sizing, source-aware recommendations, and app/Reset integration.
- [x] Run targeted settings and app checks.

### Task 2: Geometry and opacity

Files: tracer.js, tests/browser/render.spec.js.

- [x] Probe corner snapping and smoothing independently against native source pixels; record a failing coverage/render test.
- [x] Constrain low-smoothing preconditioning without removing cubic curves.
- [x] Observe a failing unbiased-alpha test, then implement nearest-band alpha rounding.
- [x] Run engine and rasterization regressions.

### Task 3: Corpus and publication

Files: tests/benchmark/quality-cases.js, accuracy runner/results, tests/fixtures, README.md.

- [x] Record the pinned baseline and updated errors across the full corpus, including source-sized renders on black and white.
- [x] Inspect complete images and enlarged detail, documenting improvements and remaining limitations.
- [x] Run full test suites and independent review; update documentation.

## Verification ledger

- 29 unit tests and 38 browser tests passed, including the large textured-image fidelity comparison, actual downloaded panorama rendering, worker lifecycle, conversion, opacity, and desktop/mobile flows.
- Accuracy run: 21 tracked reproducible cases and one local user source, 22 total. The baseline is pinned to f9e375d and uses its own settings and engine. Actual exports are compared at original source dimensions. All 22 white-composite RGB RMS values decreased; this is a cohort result, not a guarantee for every possible input.
- Inspected the full comparison gallery and native source-pixel crops displayed at 300%, including text edges, thin ink, face/fur texture, pixel accents, and soft alpha.
- Ruling: the original export comparison must include explicit source width/height. Measuring viewBox-only SVG omitted a real export-only aspect mismatch; the runner now matches actual app exports, and the app explicitly stretches its working viewBox to the original output dimensions.
- Ruling: rich sources below 900px use 96 tones after probes on six photos. Larger sources keep 64 to limit geometry growth. Verified simple one-axis ramps retain compact output only after an all-pixel model check. Four separately shaded regions no longer inherit that compact recommendation.
- Ruling: exact palettes use polygons with no structural cleanup, retaining source pixel accents. Clean finish remains the explicit choice for smoother grain and contours.
- Independent review found no actionable correctness/lifecycle issues and independently passed 12 settings and 17 app/render tests. It also stress-tested a 2400×1600 texture and recommended documenting large output and making that stress case reproducible; both are included.
- Observed limitation: the final 2400×1600 tiled-photo case traced at 2200×1466 into a 27.6 MB SVG with 2.4 million nodes. This is documented, with manual resolution/color/compact-preset alternatives.
- Publication follows the user's authorization: direct main commit/push under the configured identity, without AI attribution, followed by Pages and live-asset verification.
