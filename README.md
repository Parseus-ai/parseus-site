# parseus.ai website

Static site published with GitHub Pages at https://parseus.ai. Plain HTML and CSS
with a little JavaScript; no build step is needed to publish.

## Preview locally

Pages use root-relative links (`/assets/...`), so open them through a local
server rather than by double-clicking the files:

```sh
python -m http.server 8765
```

Then visit http://localhost:8765/.

- Forms are hidden until the backend is connected (see below). To review them
  without a backend, add `?preview=forms`, e.g.
  http://localhost:8765/beyond-ai-headlines/conversations/?preview=forms.
  Nothing is sent in preview. Add `&simulate=error`, `&simulate=validation` or
  `&simulate=waitlisted` to see those states.

## Structure

| Path | What it is |
| --- | --- |
| `index.html` | Home |
| `who-we-are.html` | About: founder story and "Why Parseus?" |
| `expertise.html`, `products.html`, `insights.html`, `contact.html`, `privacy.html` | Supporting pages |
| `beyond-ai-headlines/` | Initiative landing page, plus `conversations/` (applications) and `roundtables/` (registration) |
| `coming-soon.html`, `404.html` | Not indexed |
| `assets/site.css` | Shared design system |
| `assets/site-nav.css`, `assets/site-nav.js` | Shared responsive navigation |
| `assets/forms.js`, `assets/forms-config.js` | Form behaviour and the public form settings |
| `assets/brand/` | Approved brand-story artwork (web crops) and social image |
| `assets/brand/source/` | Original approved artwork, unmodified (not published) |
| `tools/build_site.py` | Writes the shared head, navigation and footer into every page |
| `ops/apps-script/` | Private form backend (Google Apps Script), setup guide and tests (not published) |

## Editing the navigation, footer or page metadata

Shared parts live between marker comments in each page
(`<!-- header:start -->` etc.). Don't edit them by hand: change `NAV`, `FOOTER`
or `PAGES` in `tools/build_site.py`, then run:

```sh
python tools/build_site.py          # update every page and sitemap.xml
python tools/build_site.py --check  # verify nothing is out of date
```

To add a page, create it with the three empty marker pairs (copy any existing
page), add it to `PAGES`, and run the builder.

## Forms (consultation applications and roundtable registration)

Submissions go to a Google Apps Script web app that stores them in a private
Google Sheet in the Parseus Google Workspace. No personal data is ever stored
in this repository. Setup: `ops/apps-script/README.md`. Once deployed, paste the
`/exec` URL into `endpoint` in `assets/forms-config.js`. Until then, visitors see
an email alternative instead of the form.

Backend tests: `node ops/apps-script/test/harness.mjs`.

## Publishing an Insight

Edit `insights.html`: replace the "in preparation" block with the commented
article-list template above it, using the real URL of the published piece.
