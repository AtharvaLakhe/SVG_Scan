# SVG Scan studio refinement

The user requests an extensive UI redesign based on the current large-canvas screenshot, authorizing routine design decisions and direct commits to main. The experience should feel like a precise creative editor, with visible artwork, legible controls, useful zoom tools, and dependable exports.

## Direction

Retain the recognizable forest and rose identity. Use deep forest #111b18, raised forest #1a2722, pale sage canvas #dbe3db, ivory text #f1f5ef, muted sage #a5b7ab, and rose #f390b1. Instrument Sans carries the interface; IBM Plex Mono is limited to code and coordinate data. Use tabular numerals for metrics. Reserve rose for selection and the primary export action. No decorative gradients, floating tool overlays over the image, or repeated marketing cards.

The UI/UX Pro Max design-system searches returned landing/documentation patterns, which do not fit this tool. Those layout suggestions are rejected. The typography, contrast, keyboard, reduced-motion, and responsive guidance informs a custom canvas-first layout. Frontend Design's subject-specific principle leads to a drafting-surface canvas, compact instrument-like controls, and quiet chrome rather than a large marketing hero.

## Layout

Desktop: a compact identity header, a short workspace introduction, tool tabs and focus/keyboard controls, then a large two-column editor. The canvas column contains a document header, persistent tools above the artwork, a clean drawing surface, and a compact footer. The inspector has labeled preset cards, readable primary controls, expandable cleanup, a palette tab, and anchored exports. The SVG-to-code view receives the same refined typography and panel treatment.

At widths below 900px, stack the inspector beneath the canvas. Mobile uses large touch targets, wrapping canvas controls, readable labels, and no horizontal document scrolling. Focus mode removes surrounding content and expands the editor; Escape restores it without discarding the image or result.

## Interaction

- Keep Compare, Vector, and Outline explicit. Show a brief view description, especially that Outline is an inspection view of path boundaries.
- Add a real 1:1 zoom action. Percentages report actual rendered scale relative to the original pixels. Fit remains a separate action.
- Add a small image navigator while zoomed. It shows the visible region and returns to Fit when clicked.
- Retain keyboard, pinch, drag, palette removal/restoration, conversion formats, and local-only processing.
- Exports are unavailable during a pending settings trace, preventing a download of the previous settings' result. Cancelling a retrace may restore the last completed result with clear feedback.
- Do not modify the tracing algorithm in this UI task.

## Constraints

Vanilla HTML/CSS/JavaScript; no runtime framework or dependency. Existing element IDs and test-covered flows remain unless deliberately updated. No new branch, pull request, or AI commit attribution. Publish to the user's existing main branch after verification. No new messages to others.

## Verification

Run real browser regressions for focus mode, absolute zoom/navigator, pending export behavior, desktop/mobile layout, and existing tracing/conversion flows. Inspect loaded, empty, code, narrow desktop, tablet, and mobile states visually, including the user's actual grayscale artwork. Check the full unit/browser suites and obtain an independent code review before publishing.
