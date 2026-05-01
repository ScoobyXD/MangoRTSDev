# Module theme rule (light/dark)

All frame modules must honor the frame colorway (`theme`) consistently.

## Rule

- If a frame theme is `dark`, module surfaces that are normally white/light in `light` mode must switch to dark surfaces.
- Text/icons/borders that are normally dark in `light` mode must switch to light values in `dark` mode.
- Keep accent colors (`accent`) for highlights/branding, but do not use them as a replacement for surface/text inversion.

## Implementation expectation

- Every module render signature should accept:
  - `accent`
  - `widgetId`
  - `hideTopControls`
  - `theme` (`"teal" | "light" | "dark"`)
- Avoid hardcoded white-only surfaces (`#fff`, `#ffffff`, `rgba(255,255,255,...)`) without a `theme === "dark"` fallback.
- New module UI controls (tabs, cards, panel containers, headers, list rows) must include both light and dark theme values.

## Current rollout note

This rule is now applied to Editor, Stats, and Company Explorer modules and should be treated as required for all future module work.
