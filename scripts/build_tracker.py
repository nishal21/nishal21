"""'What I'm building': recently active public repos plus a terminal-style log of recent commits.

Uses the REST API (GITHUB_TOKEN in Actions, anonymous locally). About 13 requests per run.
Repos are ranked by their latest non-bot commit on the default branch, so automated pushes
(blog updates, dependabot branches) don't push a repo to the top.
"""
import os
from datetime import datetime, timezone

from common import (ASSETS, CARD_H, CARD_W, FONT, IST, LANG_COLORS, MONO, THEMES, USER, card_open, esc, fail,
                    gh_api, truncate, write_atomic)

CANDIDATES = 8   # repos (by pushed_at) whose commits we read
SHOW = 4         # repos on the card
LOG_LINES = 7
PER_REPO = 2     # max log lines per repo, so one busy repo doesn't fill the log
SKIP = {USER}    # the profile repo itself is updated by bots every hour


def is_bot(c):
    login = (c.get("author") or {}).get("login", "") or ""
    name = c["commit"]["author"]["name"] or ""
    return login.endswith("[bot]") or "[bot]" in name or name in {"github-actions", "GitHub Action"}


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def ago(dt, now):
    s = (now - dt).total_seconds()
    if s < 3600:
        return f"{max(1, int(s // 60))}m ago"
    if s < 86400:
        return f"{int(s // 3600)}h ago"
    if s < 86400 * 60:
        return f"{int(s // 86400)}d ago"
    return f"{int(s // (86400 * 30))}mo ago"


def ci_status(repo):
    try:
        runs = gh_api(f"/repos/{USER}/{repo['name']}/actions/runs?branch={repo['default_branch']}&per_page=1")
    except Exception:
        return None
    if not runs.get("total_count"):
        return None  # no workflow has run on the default branch
    r = runs["workflow_runs"][0]
    if r["status"] != "completed":
        return "running"
    return {"success": "passing", "failure": "failing", "timed_out": "failing",
            "startup_failure": "failing"}.get(r["conclusion"], r["conclusion"] or "unknown")


def collect():
    repos = gh_api(f"/users/{USER}/repos?sort=pushed&per_page=100&type=owner")
    repos = [r for r in repos if not r["fork"] and not r["archived"] and not r["private"] and r["name"] not in SKIP]
    entries, log = [], []
    for r in repos[:CANDIDATES]:
        try:
            commits = gh_api(f"/repos/{USER}/{r['name']}/commits?per_page=6")
        except Exception as e:
            print(f"skip {r['name']}: {e}")
            continue
        human = [c for c in commits if not is_bot(c)]
        if not human:
            continue
        for c in human[:PER_REPO]:
            log.append(dict(repo=r["name"], when=parse(c["commit"]["committer"]["date"]),
                            msg=c["commit"]["message"].splitlines()[0], sha=c["sha"][:7]))
        entries.append(dict(name=r["name"], lang=r["language"], when=parse(human[0]["commit"]["committer"]["date"]),
                            msg=human[0]["commit"]["message"].splitlines()[0], repo=r))
    entries.sort(key=lambda e: e["when"], reverse=True)
    entries = entries[:SHOW]
    for e in entries:
        e["ci"] = ci_status(e["repo"])
    log.sort(key=lambda c: c["when"], reverse=True)
    return entries, log[:LOG_LINES]


def render_repos(entries, now, t):
    w, h = CARD_W, CARD_H
    out = [card_open(t, label="What I'm building: " + ", ".join(e["name"] for e in entries))]
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">What I\'m building</text>')
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{MONO}" font-size="10.5" fill="{t["muted"]}">$ ls --sort=recent</text>')
    ci_col = {"passing": t["ok"], "failing": t["bad"], "running": t["warn"]}
    y = 62
    for e in entries:
        color = LANG_COLORS.get(e["lang"], t["muted"])
        out.append(f'<circle cx="29" cy="{y-4}" r="4" fill="{color}"/>')
        name = truncate(e["name"], 150, 12.5, bold=True)
        out.append(f'<text x="40" y="{y}" font-family="{FONT}" font-size="12.5" font-weight="600" fill="{t["text"]}">{esc(name)}</text>')
        out.append(f'<text x="200" y="{y}" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{esc(truncate(e["lang"] or "", 85, 11))}</text>')
        if e["ci"]:
            c = ci_col.get(e["ci"], t["muted"])
            out.append(f'<rect x="292" y="{y-10.5}" width="76" height="14" rx="7" fill="{c}" fill-opacity="0.15"/>')
            out.append(f'<text x="330" y="{y}" text-anchor="middle" font-family="{FONT}" font-size="9.5" font-weight="600" fill="{c}">CI {esc(e["ci"])}</text>')
        out.append(f'<text x="{w-25}" y="{y}" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{ago(e["when"], now)}</text>')
        out.append(f'<text x="40" y="{y+15}" font-family="{MONO}" font-size="11" fill="{t["muted"]}" fill-opacity="0.85">{esc(truncate(e["msg"], w-25-40, 11, mono=True))}</text>')
        y += 32
    out.append("</svg>\n")
    return "\n".join(out)


def render_log(log, now, t):
    w, h = CARD_W, CARD_H
    out = [card_open(t, label=f"Recent commits across {USER}'s public repos")]
    out.append("<style>@keyframes b{50%{opacity:0}}.cur{animation:b 1.1s steps(1) infinite}</style>")
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Recent commits</text>')
    upd = now.astimezone(IST).strftime("updated %b %-d, %H:%M IST")
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{upd}</text>')
    size, cw = 11, 11 * 0.6
    y = 58
    for c in log:
        ts = c["when"].astimezone(IST).strftime("%m-%d %H:%M")
        repo = truncate(c["repo"], 15 * cw, size, mono=True)
        x_repo = 25 + 12 * cw
        x_msg = x_repo + 16 * cw
        out.append(f'<text x="25" y="{y}" font-family="{MONO}" font-size="{size}" fill="{t["muted"]}">{ts}</text>')
        out.append(f'<text x="{x_repo:.1f}" y="{y}" font-family="{MONO}" font-size="{size}" fill="{t["icon"]}">{esc(repo)}</text>')
        out.append(f'<text x="{x_msg:.1f}" y="{y}" font-family="{MONO}" font-size="{size}" fill="{t["text"]}">{esc(truncate(c["msg"], w-25-x_msg, size, mono=True))}</text>')
        y += 16.5
    out.append(f'<text x="25" y="{y}" font-family="{MONO}" font-size="{size}" fill="{t["title"]}">$ <tspan class="cur">▋</tspan></text>')
    out.append("</svg>\n")
    return "\n".join(out)


def main():
    try:
        entries, log = collect()
        if not entries:
            raise RuntimeError("no active repos found")
    except Exception as e:
        fail(str(e))
    now = datetime.now(timezone.utc)
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"building-{name}.svg"), render_repos(entries, now, t))
        write_atomic(os.path.join(ASSETS, f"commits-{name}.svg"), render_log(log, now, t))
    for e in entries:
        print(f"repo {e['name']:<16} {e['lang']!s:<11} ci={e['ci']!s:<8} {e['when']} {e['msg'][:60]!r}")
    for c in log:
        print(f"log  {c['when'].astimezone(IST):%Y-%m-%d %H:%M} {c['repo']:<16} {c['msg'][:60]!r}")


if __name__ == "__main__":
    main()
