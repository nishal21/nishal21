"""Shared helpers for the profile cards: themes, SVG text helpers, data fetching."""
import hashlib
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

USER = os.environ.get("PROFILE_USER", "nishal21")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
IST = timezone(timedelta(hours=5, minutes=30))

# Same palettes as github-readme-stats "tokyonight" and "default", so the cards sit next to them.
THEMES = {
    "dark": dict(bg="#1a1b27", border="#e4e2e2", title="#70a5fd", text="#38bdae", icon="#bf91f3",
                 muted="#a9b1d6", faint="#2a2e45", pad_off="#24283b", ok="#9ece6a", bad="#f7768e", warn="#e0af68"),
    "light": dict(bg="#fffefe", border="#e4e2e2", title="#2f80ed", text="#434d58", icon="#4c71f2",
                  muted="#57606a", faint="#eaeef2", pad_off="#ebedf0", ok="#1a7f37", bad="#cf222e", warn="#9a6700"),
}
FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif"
MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace"
CARD_W, CARD_H, RADIUS = 495, 195, 4.5

LANG_COLORS = {"TypeScript": "#3178c6", "JavaScript": "#f1e05a", "Rust": "#dea584", "Python": "#3572A5",
               "Go": "#00ADD8", "HTML": "#e34c26", "CSS": "#663399", "Shell": "#89e051", "Kotlin": "#A97BFF",
               "Astro": "#ff5a03", "Svelte": "#ff3e00"}


def esc(s):
    return html.escape(str(s), quote=True)


def _char_w(c):
    if c in "il.,:;'|!ftjrI ()[]":
        return 0.32
    if c in "mwMW@%":
        return 0.86
    if c.isupper() or c in "#&":
        return 0.66
    if c.isdigit():
        return 0.56
    if ord(c) > 0x2000:  # emoji and other wide glyphs
        return 1.0
    return 0.54


def text_width(s, size, mono=False, bold=False):
    if mono:
        return len(s) * size * 0.6
    return sum(_char_w(c) for c in s) * size * (1.08 if bold else 1.0)


def truncate(s, max_px, size, mono=False, bold=False):
    """Cut text to fit max_px, ending in an ellipsis when it was cut."""
    s = " ".join(str(s).split())
    if text_width(s, size, mono, bold) <= max_px:
        return s
    while s and text_width(s + "…", size, mono, bold) > max_px:
        s = s[:-1]
    return s.rstrip(" -,.:;|") + "…"


def card_open(t, w=CARD_W, h=CARD_H, label=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{esc(label)}">\n<title>{esc(label)}</title>\n'
            f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="{RADIUS}" fill="{t["bg"]}" '
            f'stroke="{t["border"]}" stroke-opacity="1"/>\n')


def write_atomic(path, data):
    """Write to a temp file and move it into place, so a failed run never leaves a half file."""
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = "wb" if isinstance(data, bytes) else "w"
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, mode) as f:
        f.write(data)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def http_get(url, headers=None, timeout=30, tries=3):
    """GET with a few retries, since GitHub's HTML endpoints sometimes answer 502/504."""
    req = urllib.request.Request(url, headers={"User-Agent": "nishal21-profile-cards", **(headers or {})})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries - 1:
                raise
        time.sleep(3 * (attempt + 1))


def gh_api(path):
    """GET a REST endpoint. Set PROFILE_CACHE=/some/dir to reuse responses during local testing."""
    cache = os.environ.get("PROFILE_CACHE")
    if cache:
        key = os.path.join(cache, hashlib.sha1(path.encode()).hexdigest() + ".json")
        if os.path.exists(key):
            with open(key) as f:
                return json.load(f)
    headers = {"Accept": "application/vnd.github+json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    data = json.loads(http_get("https://api.github.com" + path, headers))
    if cache:
        os.makedirs(cache, exist_ok=True)
        with open(key, "w") as f:
            json.dump(data, f)
    return data


def _graphql_calendar():
    q = {"query": "query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{"
                  "totalContributions weeks{contributionDays{date contributionCount}}}}}}",
         "variables": {"u": USER}}
    req = urllib.request.Request("https://api.github.com/graphql", data=json.dumps(q).encode(),
                                 headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "nishal21-profile-cards"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    weeks = d["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]
    return {date.fromisoformat(x["date"]): x["contributionCount"] for w in weeks for x in w["contributionDays"]}


def calendar_page(query=""):
    """The public contributions fragment (the profile graph). query like "?from=2023-01-01&to=2023-12-31"."""
    return http_get(f"https://github.com/users/{USER}/contributions{query}",
                    {"X-Requested-With": "XMLHttpRequest"}).decode("utf-8", "replace")


def parse_calendar(page):
    """Daily counts from a contributions fragment, read from each cell's tooltip."""
    ids = dict(re.findall(r'data-date="(\d{4}-\d{2}-\d{2})" id="([^"]+)"', page))
    by_id = {v: k for k, v in ids.items()}
    days = {}
    for target, label in re.findall(r'<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<', page):
        if target in by_id:
            m = re.match(r"\s*(\d+|No) contribution", label)
            days[date.fromisoformat(by_id[target])] = 0 if not m or m.group(1) == "No" else int(m.group(1))
    return days


def _html_calendar():
    days = parse_calendar(calendar_page())
    if len(days) < 300:
        raise RuntimeError(f"contribution calendar looks incomplete ({len(days)} days)")
    return days


def contribution_calendar():
    """Daily contribution counts for the last year, as shown on the public profile.

    The public calendar page is tried first because it matches the number on the profile
    (it includes private contributions if the user shows them). GraphQL is the fallback.
    """
    errors = []
    for fn in (_html_calendar, _graphql_calendar):
        if fn is _graphql_calendar and not TOKEN:
            continue
        try:
            return fn()
        except Exception as e:  # try the next source
            errors.append(f"{fn.__name__}: {e}")
    raise RuntimeError("no contribution data: " + "; ".join(errors))


def fail(msg):
    print(f"error: {msg}. Keeping the previous image.", file=sys.stderr)
    sys.exit(1)


def wrap(s, max_px, size, lines=2, mono=False, bold=False):
    """Word-wrap into at most `lines` lines; the last line is truncated with an ellipsis if needed."""
    words = " ".join(str(s).split()).split(" ")
    out, cur = [], ""
    for i, wd in enumerate(words):
        trial = (cur + " " + wd).strip()
        if text_width(trial, size, mono, bold) <= max_px or not cur:
            cur = trial
            continue
        out.append(cur)
        cur = wd
        if len(out) == lines - 1:
            cur = " ".join(words[i:])
            break
    out.append(cur)
    return [truncate(x, max_px, size, mono, bold) for x in out[:lines]]


def replace_block(path, name, content):
    """Replace the text between <!--NAME:START--> and <!--NAME:END--> in a file. Returns True if changed."""
    start, end = f"<!--{name}:START-->", f"<!--{name}:END-->"
    with open(path, encoding="utf-8") as f:
        text = f.read()
    a, b = text.find(start), text.find(end)
    if a < 0 or b < a:
        print(f"{name} markers not found in {path}; leaving it alone")
        return False
    new = text[:a + len(start)] + "\n" + content.strip("\n") + "\n" + text[b:]
    if new != text:
        write_atomic(path, new)
        return True
    return False
