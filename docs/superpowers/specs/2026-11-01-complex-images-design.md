# Complex image fidelity

The user authorized broad development of SVG Scan, with complex images as the primary problem. Keep the static, private, dependency-free browser application and its existing formats. Work on branch `codex/complex-image-fidelity` in the clean original checkout so GitHub Desktop can review it directly.

## Outcomes

- Preserve more colors and fine edges in complex artwork and photos. Add a detailed preset and expose up to 128 colors; the engine supports up to 256.
- Offer Fast (900 px), Balanced (1400 px), and Fine (2200 px) working resolution, with a 4 million pixel ceiling. Display actual working dimensions and explain the file size tradeoff.
- Add edge-aware denoising that respects contrasting edges, instead of forcing box blur on photos. Existing presets remain available, including a compact photo preset.
- Preserve translucent artwork with a vector opacity mask applied once to the composed image, rather than discarding all alpha below 128. No embedded raster images.
- Keep small opaque features and transparent holes. Validate malformed engine inputs before allocating memory.
- Make replacement images, quick setting changes, cancellation, and worker failure reliable. Stale results must never replace the current image. Export must represent the current displayed result, and be disabled while a new image has no result.
- Measure changes against the existing logo, line art, gradient, dog and mountain fixtures. Add repeatable Node tests plus browser integration and rendering checks.

## Implementation choices

Use the current OKLab palette and curve fitter. Extend its palette limit, add a small bilateral filter, preserve exact flat colors, and separate alpha from RGB composition. Keep global gradient merging unchanged initially: changing connected-region topology at the same time would make fidelity regressions hard to diagnose. Document the remaining limitation of a single shading model per palette layer.

Keep the established visual design. Add settings within the existing panel, use native labeled controls, and retain keyboard and mobile access. Avoid animation across hundreds of thousands of nodes.

## Evidence

Baseline at existing working resolution: dog 19.61 RMSE / 254 KB; mountain 14.26 / 131 KB; logo 7.66; line art 7.38; orb 5.38; sunset 2.94. A preliminary 64-color trace with no blur reduces dog error to 11.09 and mountain to 11.05, but increases output to 3.8 MB and 2.8 MB. Quality must be an explicit choice.

## UI development (user follow-up)

The user explicitly requested UI/UX Pro Max development during implementation. The interface keeps its cutting-mat identity: pine background #0d1814, raised green #13221d, mint type #e8f1ec, muted sage #94ada1, and pink actions #ff5d8f. Schibsted Grotesk carries the interface; JetBrains Mono is restricted to measurements. A concise header leads directly into a large canvas and a bounded inspector. Adjust/Palette tabs and collapsed advanced controls reduce scanning; the export footer remains visible on desktop. Mobile stacks the canvas and settings without horizontal overflow. Canvas backgrounds, reset/restore actions, and an accessible shortcut dialog are functional, with keyboard file selection.

Review corrections: preserve mask paint during currentColor conversion; explicitly reject masks in Android output; bound alpha contours before allocation; reject signed byte input; assign load IDs at the initiating user action, including asynchronous sample generation.
