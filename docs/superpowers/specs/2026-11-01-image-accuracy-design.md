# Multi-image accuracy

The user asks for independent multi-image testing, accuracy fixes, and direct GitHub updates. Existing authorization requires work on main under the configured user identity, with no AI attribution.

## Evidence and direction

A baseline audit covers 20 sources: six existing generated art/logo/line examples, six photographic fixtures, seven deterministic transparency/gradient/ink/pixel-art fixtures, and the user's grayscale source (local only). Measurements compare SVG renders to the original image dimensions, composited on both white and black, and measure alpha separately.

The audit exposes native-pixel accuracy losses from forced enlargement of small sources, deformation in the Detailed curve preconditioning, overaggressive cleanup for flat artwork, and biased opacity quantization. Preserve source pixels, constrain fitting changes, keep exact palettes and marks when the input supports that, and round alpha to the nearest band. Clean finish and compact manual presets remain explicit alternatives to faithful tracing.

## Scope

- Working-size choices downscale to their documented limits without enlarging the source.
- Detailed fitting must remain curved while respecting a tighter displacement budget at low smoothing.
- Automatic recommendations preserve exact palettes of at most 128 visible RGB colors with structural cleanup disabled; richer sources prioritize the Detailed preset. Fully transparent RGB is ignored; translucent content participates.
- Fine resolution becomes the initial quality choice. Explicit Fast/Balanced choices remain available.
- Alpha banding uses nearest-level quantization rather than increasing every nonzero opacity.
- Add a repeatable multi-image benchmark with source-dimension RGB/alpha error, file size, node count and timing, before/after gallery, and focused behavioral regressions.
- Do not replace artwork with embedded bitmaps or filters, and do not claim that noisy or low-resolution sources become infinitely detailed drawings.

## Verification

All existing engine, browser, export, and UI regressions must pass. New fixes get failing tests before implementation. Run the full image corpus and inspect full views and enlarged crops. Include exact synthetic inputs and public-domain/CC0 photographic fixtures with provenance. Obtain an independent code review, commit directly to main, push, and verify deployment and live assets.
