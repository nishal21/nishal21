"""Per-week facts for the contribution song, from public GitHub data.

  week_langs():  the dominant language of each week, from his commits to his own public non-fork repos
                 (commit search, mapped to each repo's primary language).
  week_events(): notable events per week: releases, merged pull requests (with size), new repos, and the
                 single biggest contribution day of the window.

Everything fetched is kept in a JSON cache (SONG_DATA_CACHE, default ~/.cache/song-data/cache.json) that the
workflow restores between nightly runs, so a normal night only asks for the last couple of weeks:
  - commits: by sha, refreshed from 10 days before the last fetch
  - releases: each repo's public releases feed, refetched only when the repo was pushed since
  - pull requests: details of merged PRs never change, so each is fetched once
The release feeds (github.com/<user>/<repo>/releases.atom) are plain public pages, not API calls.
"""
import json
import os
import re
import time
import urllib.parse
from datetime import date, timedelta

from common import TOKEN, USER, gh_api, http_get

CACHE = os.environ.get("SONG_DATA_CACHE", os.path.expanduser("~/.cache/song-data/cache.json"))

# language -> timbre family used by the song (anything else, or no commits, keeps the default sound)
FAMILY = {"Rust": "gritty", "Go": "gritty", "C": "gritty", "C++": "gritty", "Zig": "gritty",
          "TypeScript": "bright", "JavaScript": "bright",
          "Python": "soft", "Jupyter Notebook": "soft",
          "HTML": "airy", "CSS": "airy", "SCSS": "airy"}

BIG_PR = 300  # additions + deletions for a merged PR to count as big


def _load():
    try:
        with open(CACHE) as f:
            c = json.load(f)
    except (OSError, ValueError):
        c = {}
    for k in ("commits", "releases", "prs"):
        c.setdefault(k, {})
    return c


def _save(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(c, f, separators=(",", ":"))
    os.replace(tmp, CACHE)


def _search(kind, q):
    """All results of a search query (at most 1000), politely paced for the search rate limit."""
    out, page = [], 1
    while True:
        res = gh_api(f"/search/{kind}?q={urllib.parse.quote(q, safe=':<>=+')}&per_page=100&page={page}")
        out += res.get("items", [])
        if len(res.get("items", [])) < 100 or len(out) >= min(res.get("total_count", 0), 1000):
            return out
        page += 1
        time.sleep(2 if TOKEN else 7)


def _own_repos():
    repos = gh_api(f"/users/{USER}/repos?sort=pushed&per_page=100&type=owner")
    return {r["name"]: r for r in repos if not r["fork"] and r["name"] != USER}


def _refresh(first, today):
    c = _load()
    repos = _own_repos()
    c["repos"] = {n: dict(language=r["language"], created=r["created_at"][:10], pushed=r["pushed_at"])
                  for n, r in repos.items()}
    # commits, by sha (search only covers default branches)
    since = first
    if c.get("commits_until"):
        since = max(first, date.fromisoformat(c["commits_until"]) - timedelta(days=10))
    for it in _search("commits", f"author:{USER} committer-date:>={since}"):
        repo = it["repository"]
        if repo["owner"]["login"].lower() == USER.lower() and not repo["fork"]:
            c["commits"][it["sha"]] = [repo["name"], it["commit"]["author"]["date"][:10]]
    c["commits_until"] = str(today)
    c["commits"] = {k: v for k, v in c["commits"].items() if v[1] >= str(first - timedelta(days=7))}
    # releases: public Atom feed per repo pushed inside the window, refetched only after a push
    for name, r in c["repos"].items():
        if r["pushed"][:10] < str(first):
            continue
        old = c["releases"].get(name)
        if old and old.get("pushed") == r["pushed"]:
            continue
        try:
            feed = http_get(f"https://github.com/{USER}/{name}/releases.atom").decode("utf-8", "replace")
        except Exception as e:
            print(f"releases feed for {name} unavailable ({e})")
            continue
        items = []
        for entry in re.findall(r"<entry>(.*?)</entry>", feed, re.S):
            upd = re.search(r"<updated>([^<]+)</updated>", entry)
            title = re.search(r"<title>([^<]*)</title>", entry)
            if upd:
                items.append([upd.group(1)[:10], (title.group(1) if title else "").strip()])
        c["releases"][name] = dict(pushed=r["pushed"], items=items)
    # merged pull requests in his own repos, with size from the PR itself (fetched once)
    for it in _search("issues", f"is:pr author:{USER} is:merged merged:>={first}"):
        owner, repo = it["repository_url"].split("/")[-2:]
        if owner.lower() != USER.lower() or repo not in repos:
            continue
        key = f"{repo}#{it['number']}"
        if key not in c["prs"]:
            pr = gh_api(f"/repos/{owner}/{repo}/pulls/{it['number']}")
            c["prs"][key] = dict(repo=repo, title=pr["title"], merged=pr["merged_at"][:10],
                                 size=pr["additions"] + pr["deletions"])
    _save(c)
    return c


def load_data(weeks):
    first = weeks[0][0][0]
    today = weeks[-1][-1][0]
    try:
        return _refresh(first, today)
    except Exception as e:
        print(f"song data refresh failed ({e}); using the cached copy")
        c = _load()
        return c if c.get("repos") else None


def _week_index(weeks):
    idx = {}
    for i, w in enumerate(weeks):
        for d, _ in w:
            idx[str(d)] = i
    return idx


def week_langs(weeks, data):
    """[language or None] per week: the primary language of the repos he committed to most that week."""
    out = [None] * len(weeks)
    if not data:
        return out
    idx = _week_index(weeks)
    counts = [{} for _ in weeks]
    for repo, day in data["commits"].values():
        i = idx.get(day)
        lang = (data["repos"].get(repo) or {}).get("language")
        if i is not None and lang:
            counts[i][lang] = counts[i].get(lang, 0) + 1
    for i, c in enumerate(counts):
        if c:
            out[i] = max(sorted(c), key=lambda k: c[k])
    return out


def week_events(weeks, data):
    """[[{type, repo, title}]] per week, biggest first: release, pr (big merged PR), peak (day), repo (new)."""
    out = [[] for _ in weeks]
    idx = _week_index(weeks)
    order = {"release": 0, "pr": 1, "peak": 2, "repo": 3}
    if data:
        for repo, rel in data["releases"].items():
            for day, title in rel["items"]:
                if day in idx:
                    out[idx[day]].append(dict(type="release", repo=repo, title=title))
        for pr in data["prs"].values():
            if pr["merged"] in idx and pr["size"] >= BIG_PR:
                out[idx[pr["merged"]]].append(dict(type="pr", repo=pr["repo"], title=pr["title"]))
        for repo, r in data["repos"].items():
            if r["created"] in idx:
                out[idx[r["created"]]].append(dict(type="repo", repo=repo, title=f"created {repo}"))
    days = [(c, d) for w in weeks for d, c in w]
    if days and max(days)[0] > 0:
        c, d = max(days, key=lambda x: (x[0], x[1]))
        out[idx[str(d)]].append(dict(type="peak", repo=None, title=f"{c} contributions on {d}"))
    for ev in out:
        ev.sort(key=lambda e: order[e["type"]])
    return out
