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
- Authenticated pages must keep the shared rounded Mango taskbar header. Do not add separate page-specific headers that replace it.
- Editor exception: `Indent Guides` is not a brand-font surface. It must use the shared editor monospace stack for both text and guide overlay metrics so five-space tabs align with the vertical guide columns.

## Rule

- If a frame theme is `dark`, module surfaces that are normally white/light in `light` mode must switch to dark surfaces.
- Text/icons/borders that are normally dark in `light` mode must switch to light values in `dark` mode.
- Keep accent colors (`accent`) for highlights/branding, but do not use them as a replacement for surface/text inversion.

## Elevated surface UI

The official frontend term for the floating raised panel/card treatment is **elevated surface**.

Use **elevated surface** for UI objects that should visually float above their surrounding area while still behaving as normal layout content when needed. Examples include the bottom taskbar surface and key views column sections such as expanded Logic Gate explorer groups.

Required visual semantics:

- The surface reads as one cohesive object, with the header and expanded body connected when open.
- Use a rounded outer container, a subtle border, layered drop shadow, a light surface gradient, and a small inset highlight.
- Optional backdrop blur is allowed when it supports the floating illusion without making text harder to read.
- If the elevated surface expands inline, it must still occupy layout space and push following UI down. Do not use absolute overlay behavior unless the component is intentionally a popover.
- Selection and hover states inside elevated surfaces should use the shared cyan/light-blue interaction treatment unless the component has a specific brand exception.

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
