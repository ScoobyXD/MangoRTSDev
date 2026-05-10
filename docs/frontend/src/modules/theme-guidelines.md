# Module theme and brand rule

All frame modules must honor the frame colorway (`theme`) consistently.
The default MangoRTS brand theme is the Mango orange scheme with Helvetica Neue typography.
Teal remains a selectable legacy colorway, but it is not the default.

## Default brand tokens

- Font family: `Helvetica Neue` (`"Helvetica Neue", Helvetica, Arial, sans-serif` fallback stack).
- Mango gradient, left to right:
  - `rgba(251, 177, 82, 1)` / `#fbb152`
  - `rgba(254, 169, 78, 1)` / `#fea94e`
  - `rgba(254, 155, 70, 1)` / `#fe9b46`
  - `rgba(255, 136, 32, 1)` / `#ff8820`
- Single-color accent fallback: `rgb(255, 136, 32)` / `#ff8820`.
- White surfaces should remain white unless a dark theme explicitly applies.
- Product wordmark: use the hexagon Mango mark and `MangoRTS` casing from `frontend/src/app/MangoLogo.tsx`.
- Typography weight: default UI labels should stay in the 400-600 range. Do not force module names, header text, tab labels, or panel headings into all-caps.

## Rule

- If a frame theme is `dark`, module surfaces that are normally white/light in `light` mode must switch to dark surfaces.
- Text/icons/borders that are normally dark in `light` mode must switch to light values in `dark` mode.
- Keep accent colors (`accent`) for highlights/branding, but do not use them as a replacement for surface/text inversion.

## Implementation expectation

- Every module render signature should accept:
  - `accent`
  - `widgetId`
  - `hideTopControls`
  - `theme` (`"mango" | "teal" | "light" | "dark"`)
- Avoid hardcoded white-only surfaces (`#fff`, `#ffffff`, `rgba(255,255,255,...)`) without a `theme === "dark"` fallback.
- New module UI controls (tabs, cards, panel containers, headers, list rows) must include both light and dark theme values.

## Current rollout note

This rule is now applied to Editor and Company Explorer modules and should be treated as required for all future module work.
