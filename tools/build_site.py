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
import datetime
import html
import json
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
    ("Projects", "/projects/"),
    ("Insights", "/insights.html"),
    ("Conversations & Events", [
        ("Overview", "/conversations/"),
        ("AI strategy conversations", "/conversations/ai-strategy/"),
        ("AI roundtables", "/conversations/roundtables/"),
    ]),
    ("Contact", "/contact.html"),
]
DRAWER_CTA = ("Request an AI strategy conversation", "/conversations/ai-strategy/")

FOOTER = [
    ("Parseus AI", [
        ("About", "/who-we-are.html"),
        ("Expertise", "/expertise.html"),
        ("Projects", "/projects/"),
        ("Insights", "/insights.html"),
    ]),
    ("Conversations & Events", [
        ("Overview", "/conversations/"),
        ("AI strategy conversations", "/conversations/ai-strategy/"),
        ("AI roundtables", "/conversations/roundtables/"),
    ]),
    ("Contact", [
        (EMAIL, "mailto:" + EMAIL),
        ("Contact options", "/contact.html"),
        ("Privacy", "/privacy.html"),
    ]),
]

# Old URLs kept working: file -> new URL. Each becomes a small redirect page.
REDIRECTS = {
    "products.html": "/projects/",
    "beyond-ai-headlines/index.html": "/conversations/",
    "beyond-ai-headlines/conversations/index.html": "/conversations/ai-strategy/",
    "beyond-ai-headlines/roundtables/index.html": "/conversations/roundtables/",
}

# Header identity: optimized crop of the approved two-pillar artwork (see assets/brand/README.md)
IDENTITY = ('<img class="brand-mark" src="/assets/brand/parseus-header-identity-84.webp" '
            'srcset="/assets/brand/parseus-header-identity-84.webp 1x, /assets/brand/parseus-header-identity-168.webp 2x" '
            'width="225" height="84" alt="" />')

# ---------------------------------------------------------------------------
# Pages: file -> (url path, <title>, meta description, indexable)
# ---------------------------------------------------------------------------
PAGES = {
    "index.html": ("/", "Parseus AI | Beyond AI Headlines: From Innovation to Real-World Impact",
                   "Parseus AI turns emerging AI and intelligent systems into solutions that work in practice, across enterprise AI, robotics, manufacturing, system architecture and operations.", True),
    "who-we-are.html": ("/who-we-are.html", "About | Parseus AI",
                        "Scientist by training, builder by nature. The founder's story behind Parseus AI, and the meaning of its name: the courage of Perseus, the craft of Persia.", True),
    "expertise.html": ("/expertise.html", "Expertise | Parseus AI",
                       "Areas of expertise across enterprise and agentic AI, physical AI and robotics, manufacturing, computer vision, enterprise architecture and implementation.", True),
    "projects/index.html": ("/projects/", "Projects | Parseus AI",
                            "Maestro AI and other Parseus AI projects: what is available today and what is still in development.", True),
    "insights.html": ("/insights.html", "Insights | Parseus AI",
                      "Analysis on enterprise and agentic AI, architecture and governance, physical AI and robotics, industrial AI, and taking research to real-world implementation.", True),
    "conversations/index.html": ("/conversations/", "Conversations & Events | Parseus AI",
                                 "Complimentary 20-minute AI strategy conversations and monthly 60-minute AI roundtables on turning emerging AI capabilities into real-world value.", True),
    "conversations/ai-strategy/index.html": ("/conversations/ai-strategy/", "AI Strategy Conversations | Parseus AI",
                                             "Apply for one of ten complimentary 20-minute AI strategy conversations with Parseus AI. Applications are reviewed individually.", True),
    "conversations/roundtables/index.html": ("/conversations/roundtables/", "AI Roundtables | Parseus AI",
                                             "Monthly 60-minute AI roundtables with Parseus AI. First proposed topic: from AI capabilities to real-world value: what does it take to operationalize AI?", True),
    "contact.html": ("/contact.html", "Contact | Parseus AI",
                     "Get in touch with Parseus AI, apply for a complimentary AI strategy conversation, or register your interest in an AI roundtable.", True),
    "privacy.html": ("/privacy.html", "Privacy | Parseus AI",
                     "How Parseus AI handles the information you share through this website.", True),
    "coming-soon.html": ("/coming-soon.html", "Coming soon | Parseus AI",
                         "This Parseus AI page is still being built. Explore our expertise, projects, insights and conversations in the meantime.", False),
    "404.html": ("/404.html", "Page not found | Parseus AI",
                 "The page you were looking for could not be found. Find your way back to Parseus AI: expertise, projects, insights and conversations.", False),
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
<meta property="og:image:alt" content="Parseus AI wordmark: a blue stone pillar and a gold pillar with Persian geometric patterns form the letter P." />
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
      <a class="brand" href="/"{home_cur} aria-label="Parseus AI, home">{IDENTITY.replace('class="brand-mark"', 'class="brand-mark" fetchpriority="high"')}</a>
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="site-nav"><span class="bars" aria-hidden="true"></span><span class="label">Menu</span><span class="sr-only"> (main navigation)</span></button>
      <nav id="site-nav" class="topnav" aria-label="Main">
        <div class="nav-head">
          <a class="brand" href="/" aria-label="Parseus AI, home">{IDENTITY}</a>
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
          <a class="foot-brand" href="/" aria-label="Parseus AI, home">{IDENTITY.replace(' alt=""', ' alt="" loading="lazy"')}</a>
        </div>
{cols}
      </div>
      <div class="foot-legal">
        <span>&copy; 2026 Parseus AI. All rights reserved.</span>
      </div>
    </div>
  </footer>
  <script src="/assets/site-nav.js" defer></script>
<!-- footer:end -->'''


# ---------------------------------------------------------------------------
# Insights registry (content/insights.json) -> insights.html and homepage
# ---------------------------------------------------------------------------
INSIGHTS_FILE = ROOT / "content" / "insights.json"


def load_insights():
    data = json.loads(INSIGHTS_FILE.read_text(encoding="utf-8"))
    cats = data["categories"]
    items = []
    for i, it in enumerate(data.get("items", [])):
        where = f"content/insights.json item {i + 1}"
        for key in ("title", "date", "topic", "summary", "url"):
            if not str(it.get(key, "")).strip():
                raise SystemExit(f"{where}: missing {key}")
        if it["topic"] not in cats:
            raise SystemExit(f"{where}: topic must be one of {cats}")
        if not re.match(r"^https://", it["url"]):
            raise SystemExit(f"{where}: url must start with https://")
        try:
            it["_date"] = datetime.date.fromisoformat(it["date"])
        except ValueError:
            raise SystemExit(f"{where}: date must be YYYY-MM-DD")
        img = it.get("image") or ""
        if img and not (img.startswith("/assets/") or img.startswith("https://")):
            raise SystemExit(f"{where}: image must be a /assets/ path or https URL")
        items.append(it)
    items.sort(key=lambda x: x["_date"], reverse=True)
    return cats, items


def fmt_date(d):
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def article_html(it, heading="h3"):
    src = E(it.get("source") or "Article")
    img = ""
    if it.get("image"):
        img = f'\n            <img class="article-img" src="{E(it["image"])}" alt="{E(it.get("image_alt", ""))}" loading="lazy" decoding="async" />'
    return f"""          <li class="article">{img}
            <p class="meta">{E(it["topic"])} &middot; <time datetime="{it["_date"].isoformat()}">{fmt_date(it["_date"])}</time> &middot; {src}</p>
            <{heading}><a href="{E(it["url"])}" target="_blank" rel="noopener">{E(it["title"])}<span class="sr-only"> (opens in a new tab)</span></a></{heading}>
            <p>{E(it["summary"])}</p>
          </li>"""


def render_insights_topics(file):
    cats, _ = load_insights()
    lis = "".join(f"<li>{E(c)}</li>" for c in cats)
    return f'<!-- insights-topics:start -->\n      <ul class="topics">{lis}</ul>\n<!-- insights-topics:end -->'


def render_insights_list(file):
    cats, items = load_insights()
    if not items:
        body = """        <div class="empty" style="margin-top:1.4rem;">
          <h3>Curated analyses are being added</h3>
          <p>Selected articles and posts will be featured here, each with a link to the original piece.</p>
          <p style="margin-top:0.8rem;">Want a topic covered? <a href="mailto:info@parseus.ai?subject=Insights%20topic%20suggestion">Suggest it by email</a>, or bring it to a <a href="/beyond-ai-headlines/roundtables/">monthly roundtable</a>.</p>
        </div>"""
    else:
        parts = []
        featured = [i for i in items if i.get("featured")]
        if featured:
            parts.append('        <h3 class="group-title">Featured</h3>\n        <ul class="articles featured">\n'
                         + "\n".join(article_html(i, "h4") for i in featured) + "\n        </ul>")
        for c in cats:
            group = [i for i in items if i["topic"] == c]
            if group:
                parts.append(f'        <h3 class="group-title">{E(c)}</h3>\n        <ul class="articles">\n'
                             + "\n".join(article_html(i, "h4") for i in group) + "\n        </ul>")
        body = "\n".join(parts)
    return f"<!-- insights-list:start -->\n{body}\n<!-- insights-list:end -->"


def render_insights_featured(file):
    _, items = load_insights()
    featured = [i for i in items if i.get("featured")][:3]
    if not featured:
        return "<!-- insights-featured:start -->\n<!-- insights-featured:end -->"
    lis = "\n".join(f'          <li><a href="{E(i["url"])}" target="_blank" rel="noopener">{E(i["title"])}<span class="sr-only"> (opens in a new tab)</span></a> <span class="when">{E(i["topic"])} &middot; {fmt_date(i["_date"])}</span></li>' for i in featured)
    return f"""<!-- insights-featured:start -->
      <div class="featured-insights">
        <h3>Selected insights</h3>
        <ul>
{lis}
        </ul>
        <a class="text-link" href="/insights.html">All insights</a>
      </div>
<!-- insights-featured:end -->"""


OPTIONAL_RENDERERS = {
    "insights-topics": render_insights_topics,
    "insights-list": render_insights_list,
    "insights-featured": render_insights_featured,
}


RENDERERS = {"head": render_head, "header": render_header, "footer": render_footer}


def render_redirect(target):
    url = SITE_URL + target
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>This page has moved | Parseus AI</title>
<meta name="robots" content="noindex" />
<link rel="canonical" href="{url}" />
<meta http-equiv="refresh" content="0; url={target}" />
<script>location.replace({target!r} + location.search + location.hash);</script>
</head>
<body>
<p>This page has moved to <a href="{target}">{url}</a>.</p>
</body>
</html>
"""


def write_redirects(check, stale):
    for file, target in REDIRECTS.items():
        p = ROOT / file
        html_out = render_redirect(target)
        if not p.exists() or p.read_text(encoding="utf-8") != html_out:
            stale.append(file)
            if not check:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(html_out, encoding="utf-8", newline="\n")
                print(f"updated redirect {file} -> {target}")


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
        for name, fn in OPTIONAL_RENDERERS.items():
            pat = re.compile(rf"<!-- {name}:start -->.*?<!-- {name}:end -->", re.S)
            if pat.search(out):
                out = pat.sub(lambda m: fn(file), out, count=1)
        if out != src:
            stale.append(file)
            if not check:
                p.write_text(out, encoding="utf-8", newline="\n")
                print(f"updated {file}")
    write_sitemap(check, stale)
    write_redirects(check, stale)
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
