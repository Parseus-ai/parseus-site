# Insights import manifest

Status on 2026-10-20: **no published Insights entries are on the website.**

No LinkedIn post or article URLs were found in this repository, the other project folders on this machine, or the Documents, Downloads and Desktop folders. Nothing has been invented. The Insights page currently says "Curated analyses are being added" and does not claim to list published work.

## What is needed for each entry

Send these for each published post or article (no passwords or account access needed):

| Field | Example of what to provide | Required |
|---|---|---|
| Original URL | The exact public link, starting with `https://` (LinkedIn post, LinkedIn article or other publication) | Yes |
| Publication date | The date it was published (YYYY-MM-DD) | Yes |
| Title | The headline, or the first line of the post | Yes |
| Topic | One of the five categories below | Yes |
| Summary | One or two sentences. Claude Code can draft this from the post text if you paste the text | Yes |
| Featured | Whether it should also appear on the homepage (up to three) | Optional |
| Image | An image you own the rights to, if you want one shown | Optional |

Categories (from `content/insights.json`): Enterprise AI and Agentic Systems; Architecture and Governance; Physical AI and Robotics; Industrial and Manufacturing AI; Research to Real-World Implementation.

## Records requested in the brief (all missing)

| # | Suggested subject | Category | URL | Date | Status |
|---|---|---|---|---|---|
| 1 | Enterprise AI operating models | Enterprise AI and Agentic Systems | missing | missing | Not published on the site |
| 2 | Agentic AI architecture | Architecture and Governance | missing | missing | Not published on the site |
| 3 | AI governance and operational control | Architecture and Governance | missing | missing | Not published on the site |
| 4 | Physical AI and robotics | Physical AI and Robotics | missing | missing | Not published on the site |
| 5 | Manufacturing and industrial applications | Industrial and Manufacturing AI | missing | missing | Not published on the site |
| 6 | Research to production | Research to Real-World Implementation | missing | missing | Not published on the site |

## How entries are added

Add each record to `items` in `content/insights.json`, then run `python tools/build_site.py`. The builder rejects entries without an `https://` URL, with an unknown topic or with a badly formatted date. The page switches from the "being added" message to the article list automatically.
