# Parseus brand library

Each asset has one job. Do not swap them for one another.

## Folder structure

| Folder | Contents | Published on the website? |
|---|---|---|
| `source/` | Approved original artwork, exactly as supplied. Never edit these files. | No (excluded in `_config.yml`) |
| `masters/` | Full-resolution working crops made from `source/` (cropping only) | No |
| `header/` | Website header wordmark | Yes |
| `story/` | Brand-story version (wordmark with the two phrases) | Yes |
| `icons/` | Favicon and touch icons (plus `/favicon.ico` and `/site.webmanifest` at the site root) | Yes |
| `social/` | Open Graph / LinkedIn / X sharing image | Yes |

## Approved source artwork (`source/`)

| File | What it is | Background | Intended use |
|---|---|---|---|
| `Parseus AI_ Marble and Gold Emblem.png` (1774x887) | **A + B.** Parseus AI wordmark (navy and gold pillar P) with "The courage of Perseus \| The craft of Persia" | Transparent | Source of the header wordmark (phrases cropped off) and of the brand-story version |
| `parseus-pillars-approved-2026-10-20.png` (1448x1086) | The first approved version of the same wordmark with the phrases | Ivory | Source of the social sharing image; reference |
| `Elegant Blue and Gold Pi Emblem.png` (1254x1254) | **C.** Two sculpted columns joined by a flowing blue-and-gold beam | White | Supplementary emblem for future use. Not used on the website |
| `Two-Tone Classical Arch Emblem.png` (1312x1199) | **C.** Same emblem | Transparent | Supplementary emblem for future use. Not used on the website |
| `Minimalist Gold and White Monogram Logo-Transparent BG.png` (1254x1254) | **D.** Circular P/AI monogram. **Despite the filename, this file has the Persian-blue background.** | Persian blue (#1135BB) | Source of the favicon and touch icons |
| `Minimalist Gold and White Monogram Logo-Blue BG.png` (1254x1254) | **D.** Same monogram. **Despite the filename, this file is transparent.** | Transparent | Transparent monogram variant for future use |
| `Minimalist Gold and White Monogram Logo.png` (1254x1254) | **D.** Same monogram | Dark navy | Navy variant for future use |

The two monogram filenames appear to be swapped. The originals are kept unchanged; the table above records what each file actually contains.

## Website derivatives

| File | Made from | How | Used on |
|---|---|---|---|
| `header/parseus-wordmark-84.webp` (1x), `header/parseus-wordmark-168.webp` (2x and 3x) | `Marble and Gold Emblem` | Cropped to the wordmark only (phrases removed by cropping), resized | Header on every page (56px tall on desktop, 44px on tablets and phones, 40px at 360px and narrower), mobile menu (40px), footer (44px). Light backgrounds only |
| `story/parseus-brand-story-640.webp`, `story/parseus-brand-story-1280.webp` | `Marble and Gold Emblem` | Trimmed to its edges, resized | About page, "Why Parseus?" section, on screens 760px and wider. On narrower screens the two phrases are shown as text, stacked, each on one line |
| `icons/favicon-16.png`, `icons/favicon-32.png` | `Monogram ...-Transparent BG` (blue) | Square crop centred on the mark, resized, light sharpening for legibility at tiny sizes | Browser tab icon |
| `icons/favicon-48.png`, `icons/apple-touch-icon.png` (180), `icons/favicon-192.png`, `icons/favicon-512.png` | Same | Square crop centred on the mark with a little more margin, resized | `/favicon.ico` (16, 32, 48), iOS home screen, web manifest |
| `social/parseus-og-1200x630.jpg` | `parseus-pillars-approved-2026-10-20.png` | Whole artwork fitted on a matching ivory canvas | Link previews |
| `masters/parseus-wordmark-master.png`, `masters/parseus-monogram-persian-blue-master.png` | As above | Full-resolution crops | Regenerating the files above |

## Not in the library

- **Original metallic silver-and-gold corporate logo:** not found in the repository or on this machine. When available, add it to `source/` and document its use here.

## Rules

- Do not redraw, recolour or regenerate approved artwork without approval. Derivatives are crops and resizes only.
- The header shows the wordmark only, never the phrases.
- The brand phrase "The courage of Perseus, the craft of Persia." appears on the About page and once, small, on the homepage. Not in the header or footer.
- The two-column emblem (C) is not the header mark and not the favicon.
- The circular monogram (D) is the favicon. It is not the header mark.
- "Beyond AI Headlines: From Innovation to Real-World Impact" is the homepage positioning, not a page or programme name.
