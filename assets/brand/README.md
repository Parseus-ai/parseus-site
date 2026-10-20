# Parseus brand assets

Which asset is used where, and why. Keep these roles separate.

| Asset | File | Used for | Notes |
|---|---|---|---|
| Original corporate logo (metallic silver and gold) | Not in this repository | Not used on the website yet | The file was not found on this machine. Add it here (for example `assets/brand/corporate/`) when available and decide where it should appear. |
| Approved two-pillar artwork (source) | `source/parseus-pillars-approved-2026-10-20.png` | Reference only. Never edited, never published | Byte-identical to the approved image (SHA-256 92e6c41a...). Excluded from the published site by `_config.yml`. |
| Transparent master | `derived/parseus-identity-transparent-master.png` | Source for the header images | Tight crop of the source wordmark with only the plain background removed (no redrawing or recolouring). Composited back on the original background it matches the source to within about 1 colour level on average. Excluded from the published site. |
| Header identity | `parseus-header-identity-84.webp` (1x), `parseus-header-identity-168.webp` (2x and 3x) | Site header, mobile menu, footer | Generated from the transparent master. Shown at 56px tall on desktop, 44px on tablets and phones, 40px at 360px and narrower, 40px in the mobile menu and 44px in the footer. Light backgrounds only (it is not legible on navy). |
| Social sharing image | `parseus-og-1200x630.jpg` | Open Graph / LinkedIn / X previews | The full approved artwork, including the two phrases, fitted proportionally on a matching ivory canvas. |
| Large artwork crops | `parseus-pillars-wordmark.webp`, `parseus-pillars-wordmark-680.webp` | Not currently used on any page | Kept from Phase 2 (former homepage brand section). Safe to delete if you do not want a large version available. |
| Favicon | None installed | | Two proposals are in the local review package (`review/phase4/favicon/`). Proposal A crops the pillar P from the approved artwork but removes the letter "a" under the curve, so it needs approval. Proposal B is a flat redrawing and also needs approval. |

## Rules

- Do not redraw, recolour or regenerate the approved artwork without approval.
- The header identity is the only brand mark in page chrome. Do not reintroduce the old text-based "Πarseus AI" mark.
- The phrase "The courage of Perseus, the craft of Persia." appears only in the About page ("Why Parseus?") and once, small, on the homepage. It is not part of the header, footer or other pages.
- "Beyond AI Headlines: From Innovation to Real-World Impact" is the homepage positioning only. It is not a programme or page name.

## Regenerating the header images

From the repository root, with Python and Pillow installed, the header images are produced by resizing `derived/parseus-identity-transparent-master.png` to 84px and 168px tall with Lanczos resampling and saving as WebP (quality 92).
