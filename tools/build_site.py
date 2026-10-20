"""Parseus AI site builder.

Writes the shared <head> metadata, header/navigation and footer into every page,
between marker comments:

    <!-- head:start --> ... <!-- head:end -->
    <!-- header:start --> ... <!-- header:end -->
    <!-- footer:start --> ... <!-- footer:end -->

Edit NAV, FOOTER or PAGES below, then run from the repo root:

    python tools/build_site.py           # update pages
    python tools/build_site.py --check   # exit 1 if any page is out of date

No dependencies beyond the Python standard library.
"""
import html
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE_URL = "https://parseus.ai"
OG_IMAGE = SITE_URL + "/assets/brand/parseus-og-1200x630.jpg"
EMAIL = "info@parseus.ai"
MAESTRO_DOCS = "https://parseus-ai.github.io/maestro-ai/"

# ---------------------------------------------------------------------------
# Information architecture. Only link to pages that exist.
# A tuple (label, url) is a single link; (label, [items]) is a submenu.
# Submenu items: (label, url) or (label, url, "external").
# ---------------------------------------------------------------------------
NAV = [
    ("Home", "/"),
    ("About", "/who-we-are.html"),
    ("Expertise", "/expertise.html"),
    ("Products & Projects", [
        ("All products and projects", "/products.html"),
        ("Maestro AI", MAESTRO_DOCS, "external"),
    ]),
    ("Insights", "/insights.html"),
    ("Events & Conversations", [
        ("Beyond AI Headlines", "/beyond-ai-headlines/"),
        ("Strategy conversations", "/beyond-ai-headlines/conversations/"),
        ("Monthly roundtables", "/beyond-ai-headlines/roundtables/"),
    ]),
    ("Contact", "/contact.html"),
]
DRAWER_CTA = ("Apply for a strategy conversation", "/beyond-ai-headlines/conversations/")

FOOTER = [
    ("Parseus AI", [
        ("Who we are", "/who-we-are.html"),
        ("Expertise", "/expertise.html"),
        ("Products & projects", "/products.html"),
        ("Insights", "/insights.html"),
    ]),
    ("Beyond AI Headlines", [
        ("Overview", "/beyond-ai-headlines/"),
        ("Strategy conversations", "/beyond-ai-headlines/conversations/"),
        ("Monthly roundtables", "/beyond-ai-headlines/roundtables/"),
    ]),
    ("Contact", [
        (EMAIL, "mailto:" + EMAIL),
        ("Contact options", "/contact.html"),
        ("Privacy", "/privacy.html"),
    ]),
]

# ---------------------------------------------------------------------------
# Pages: file -> (url path, <title>, meta description, indexable)
# ---------------------------------------------------------------------------
PAGES = {
    "index.html": ("/", "Parseus AI | Beyond AI Headlines: From Innovation to Real-World Impact",
                   "Parseus AI connects scientific research, intelligent technologies, system architecture and operations to turn AI innovation into reliable, real-world impact.", True),
    "who-we-are.html": ("/who-we-are.html", "Who we are | Parseus AI",
                        "Scientist by training, builder by nature. The founder's story behind Parseus AI, and the meaning of its name: the courage of Perseus, the craft of Persia.", True),
    "expertise.html": ("/expertise.html", "Expertise | Parseus AI",
                       "Areas of expertise across enterprise and agentic AI, physical AI and robotics, manufacturing, computer vision, enterprise architecture and implementation.", True),
    "products.html": ("/products.html", "Products & Projects | Parseus AI",
                      "Maestro AI is available today. See what Parseus AI has released and what is still in development.", True),
    "insights.html": ("/insights.html", "Insights | Parseus AI",
                      "Independent analysis on enterprise AI, agentic AI, physical AI, robotics, manufacturing and what it takes to implement them.", True),
    "contact.html": ("/contact.html", "Contact | Parseus AI",
                     "Get in touch with Parseus AI, apply for a complimentary strategy conversation, or register for a monthly AI roundtable.", True),
    "privacy.html": ("/privacy.html", "Privacy | Parseus AI",
                     "How Parseus AI handles the information you share through this website.", True),
    "beyond-ai-headlines/index.html": ("/beyond-ai-headlines/", "Beyond AI Headlines: From Innovation to Real-World Impact | Parseus AI",
                                       "Independent insights, ten complimentary 20-minute AI strategy conversations and monthly 60-minute roundtables on making AI work in the real world.", True),
    "beyond-ai-headlines/conversations/index.html": ("/beyond-ai-headlines/conversations/", "Apply for a complimentary AI strategy conversation | Parseus AI",
                                                     "Apply for one of ten complimentary 20-minute AI strategy conversations with Parseus AI. Applications are reviewed individually.", True),
    "beyond-ai-headlines/roundtables/index.html": ("/beyond-ai-headlines/roundtables/", "Monthly AI roundtables | Parseus AI",
                                                   "Register for a monthly 60-minute AI roundtable. First topic: From AI capabilities to real-world value: what does it take to operationalize AI?", True),
    "coming-soon.html": ("/coming-soon.html", "Coming soon | Parseus AI",
                         "This Parseus AI page is still being built. Explore our expertise, products and the Beyond AI Headlines initiative in the meantime.", False),
    "404.html": ("/404.html", "Page not found | Parseus AI",
                 "The page you were looking for could not be found. Find your way back to Parseus AI and the Beyond AI Headlines initiative.", False),
}

E = html.escape


def render_head(file):
    path, title, desc, index = PAGES[file]
    url = SITE_URL + path
    robots = "" if index else '\n<meta name="robots" content="noindex" />'
    return f'''<!-- head:start -->
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}" />{robots}
<link rel="canonical" href="{url}" />
<meta name="theme-color" content="#F7F5F0" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Parseus AI" />
<meta property="og:title" content="{E(title)}" />
<meta property="og:description" content="{E(desc)}" />
<meta property="og:url" content="{url}" />
<meta property="og:image" content="{OG_IMAGE}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Parseus AI wordmark: a blue stone pillar and a gold pillar with Persian geometric patterns form the letter P. The courage of Perseus, the craft of Persia." />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500;1,9..144,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/site.css" />
<link rel="stylesheet" href="/assets/site-nav.css" />
<!-- head:end -->'''


def slug(s):
    return re.sub(r"[^a-z]+", "-", s.lower()).strip("-")


def is_current(href, current):
    return href == current


def render_header(file):
    current = PAGES[file][0]
    I = "        "
    out = []
    for entry in NAV:
        label, target = entry
        if isinstance(target, str):
            cur = ' aria-current="page"' if is_current(target, current) else ""
            cls = "navlabel nav-contact" if label == "Contact" else "navlabel"
            out.append(f'{I}<li class="navitem"><a class="{cls}" href="{target}"{cur}>{E(label)}</a></li>')
            continue
        sid = "sub-" + slug(label)
        active = " active" if any(is_current(i[1], current) for i in target) else ""
        out.append(f'{I}<li class="navitem">')
        out.append(f'{I}  <button type="button" class="navlabel{active}" aria-expanded="false" aria-controls="{sid}">{E(label)} <span class="caret" aria-hidden="true">&#9662;</span></button>')
        out.append(f'{I}  <ul class="dropdown" id="{sid}">')
        for item in target:
            name, href = item[0], item[1]
            ext = len(item) > 2 and item[2] == "external"
            cur = ' aria-current="page"' if is_current(href, current) else ""
            extra = ' target="_blank" rel="noopener"' if ext else ""
            tail = ' <span class="ext" aria-hidden="true">&#8599;</span><span class="sr-only"> (opens in a new tab)</span>' if ext else ""
            out.append(f'{I}    <li><a href="{href}"{extra}{cur}>{E(name)}{tail}</a></li>')
        out.append(f'{I}  </ul>')
        out.append(f'{I}</li>')
    items = "\n".join(out)
    home_cur = ' aria-current="page"' if current == "/" else ""
    cta_label, cta_href = DRAWER_CTA
    return f'''<!-- header:start -->
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="wrap site-header">
    <header class="topbar">
      <a class="brand" href="/"{home_cur} aria-label="Parseus AI, home"><span class="pi" aria-hidden="true">&Pi;</span><span aria-hidden="true">arseus AI</span></a>
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="site-nav"><span class="bars" aria-hidden="true"></span><span class="label">Menu</span><span class="sr-only"> (main navigation)</span></button>
      <nav id="site-nav" class="topnav" aria-label="Main">
        <div class="nav-head">
          <a class="brand" href="/" aria-label="Parseus AI, home"><span class="pi" aria-hidden="true">&Pi;</span><span aria-hidden="true">arseus AI</span></a>
          <button type="button" class="nav-close"><span class="x" aria-hidden="true">&times;</span><span>Close</span><span class="sr-only"> menu</span></button>
        </div>
        <ul class="navlist">
{items}
        </ul>
        <a class="nav-cta" href="{cta_href}">{E(cta_label)} <span aria-hidden="true">&rarr;</span></a>
      </nav>
      <button type="button" class="nav-scrim" tabindex="-1" aria-hidden="true"></button>
    </header>
  </div>
<!-- header:end -->'''


def render_footer(file):
    cols = []
    for heading, links in FOOTER:
        lis = "\n".join(f'            <li><a href="{h}">{E(t)}</a></li>' for t, h in links)
        cols.append(f'''        <div class="foot-col">
          <h2>{E(heading)}</h2>
          <ul>
{lis}
          </ul>
        </div>''')
    cols = "\n".join(cols)
    return f'''<!-- footer:start -->
  <footer class="site-footer">
    <div class="wrap">
      <div class="foot-grid">
        <div class="foot-about">
          <div class="foot-brand"><span class="pi" aria-hidden="true">&Pi;</span>arseus AI</div>
          <p class="foot-tag">The courage of Perseus, the craft of Persia.</p>
        </div>
{cols}
      </div>
      <div class="foot-legal">
        <span>&copy; 2026 Parseus AI. All rights reserved.</span>
        <span>Beyond AI Headlines: From Innovation to Real-World Impact</span>
      </div>
    </div>
  </footer>
  <script src="/assets/site-nav.js" defer></script>
<!-- footer:end -->'''


RENDERERS = {"head": render_head, "header": render_header, "footer": render_footer}


def build(check=False):
    stale = []
    for file in PAGES:
        p = ROOT / file
        if not p.exists():
            print(f"missing page: {file}")
            stale.append(file)
            continue
        src = p.read_text(encoding="utf-8")
        out = src
        for name, fn in RENDERERS.items():
            pat = re.compile(rf"<!-- {name}:start -->.*?<!-- {name}:end -->", re.S)
            if not pat.search(out):
                print(f"{file}: missing <!-- {name}:start/end --> markers")
                stale.append(file)
                continue
            out = pat.sub(lambda m: fn(file), out, count=1)
        if out != src:
            stale.append(file)
            if not check:
                p.write_text(out, encoding="utf-8", newline="\n")
                print(f"updated {file}")
    write_sitemap(check, stale)
    if check and stale:
        print("Out of date:", ", ".join(sorted(set(stale))))
        sys.exit(1)
    if not stale:
        print("All pages up to date.")


def write_sitemap(check, stale):
    urls = [PAGES[f][0] for f in PAGES if PAGES[f][3]]
    body = "\n".join(f"  <url><loc>{SITE_URL}{u}</loc></url>" for u in urls)
    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}\n</urlset>\n'
    p = ROOT / "sitemap.xml"
    if not p.exists() or p.read_text(encoding="utf-8") != xml:
        stale.append("sitemap.xml")
        if not check:
            p.write_text(xml, encoding="utf-8", newline="\n")
            print("updated sitemap.xml")


if __name__ == "__main__":
    build(check="--check" in sys.argv)
