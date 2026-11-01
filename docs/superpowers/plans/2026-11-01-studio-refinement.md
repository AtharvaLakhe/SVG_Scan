# Studio Refinement Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Review uses a fresh reviewer as required by the review skill.

**Goal:** Transform SVG Scan into a refined, canvas-first editor with clearer tools and reliable export feedback.

**Architecture:** Keep the vanilla DOM application and tracing engine. Reshape index.html, replace the existing studio.css presentation layer, and extend app.js view controls. Browser tests exercise the real UI and workers.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Canvas, Web Workers, Playwright, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-01-studio-refinement-design.md

## Global Constraints

- No runtime framework, new tracing algorithm, or uploaded artwork.
- Retain existing conversion formats and accessible keyboard/file flows.
- Commit directly to main using the configured author, with no AI attribution, then push to the existing GitHub repository.

## Review Focus

- Resizing or entering focus mode retains the trace and usable zoom.
- Portrait, landscape, transparent, and all-black images do not break the navigator.
- Pending settings changes cannot export an earlier result.
- Dialog Escape and editor Escape do not conflict; controls remain keyboard accessible.
- Tablet/mobile keep exports reachable without document overflow.

### Task 1: Editor interactions

Files: app.js, index.html, tests/browser/workspace.spec.js.

- [x] Write and observe failing tests for focus/Escape, native-scale zoom/navigator, and pending retrace exports.
- [x] Implement focus mode, separate Fit and 1:1 controls, zoom readout, navigator, and explicit view feedback. Anchor canvas tools outside the artwork.
- [x] Guard pending exports and restore the last completed result after cancelling a retrace.
- [x] Run focused browser checks and existing app/studio regressions.

### Task 2: Whole UI presentation

Files: index.html, studio.css, README.md.

- [x] Replace the oversized hero and refine document header, canvas surface/tools, preset cards, inspector, export area, empty state, code view, dialogs, and footer.
- [x] Use the documented tokens, type scale, spacing, focus treatment, reduced motion, and responsive breakpoints.
- [x] Inspect desktop, narrow desktop, tablet, mobile, empty, loaded, and converter states; correct visible problems.
- [x] Run the full test suites and independent review. Update documentation.

## Verification ledger

- 25 unit tests and 30 real browser tests pass. Eight new workspace tests cover focus/dialog Escape, real 1:1 and navigator Fit, pending/cancelled export behavior, first-reveal view selection, immediate debounce blocking, short desktop exports, delayed earlier worker results, and 16,000-pixel panorama zoom with resize.
- New interaction tests were observed failing for the intended missing or broken behavior before their implementation.
- Independent review reproduced three important edge cases: code-mode access to stale results, a worker-result race during input debounce, and the native-scale zoom limit. Each now has a regression and correction; independent follow-up ran all eight workspace tests successfully with no further actionable findings.
- Visual checks cover the user's actual grayscale image, empty state, converter, focus mode, 1880/1440/1024/900/768/580/390/375 widths, and a short 1366×664 desktop. No page errors or horizontal document overflow in the checked states.
- A computed-style text contrast check found two empty-canvas labels at 4.42:1. Darkening the canvas secondary-text token corrected them; the checked empty, loaded, and converter desktop/mobile text now has no failures. This targeted check is not a claim of full accessibility certification.
- Ruling: show the introduction on the empty screen, then hide it after an image loads to give the editor more height. Use three-column compact presets on desktop and fuller two-column cards on phones.
- Ruling: retain the user's forest/rose brand, with a pale sage drawing surface for clearer separation between artwork and editor chrome. No tracing algorithm changes.
- Publishing follows the existing explicit authorization: direct main commit under the configured user identity, no AI attribution, then verify GitHub Pages and live assets.
