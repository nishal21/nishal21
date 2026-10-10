"""Last-12-months contributions card: total, best day, busiest month, longest streak, weekly bars."""
from collections import defaultdict
from common import (ASSETS, CARD_H, CARD_W, FONT, THEMES, card_open, contribution_calendar, esc, fail,
                    truncate, write_atomic)
import os


def fmt(d, year=True):
    return d.strftime("%b %-d, %Y") if year else d.strftime("%b %-d")


def stats(cal):
    days = sorted(cal)
    total = sum(cal.values())
    active = sum(1 for d in days if cal[d] > 0)
    best = max(days, key=lambda d: (cal[d], d))
    months = defaultdict(int)
    for d in days:
        months[(d.year, d.month)] += cal[d]
    bm = max(months, key=lambda k: (months[k], k))
    longest, run, start, lstart, lend = 0, 0, None, None, None
    for d in days:
        if cal[d] > 0:
            run, start = (run + 1, start) if run else (1, d)
            if run > longest:
                longest, lstart, lend = run, start, d
        else:
            run = 0
    weeks = [sum(cal[d] for d in days[i:i + 7]) for i in range(0, len(days), 7)]
    return dict(first=days[0], last=days[-1], total=total, active=active, n=len(days), best=best,
                best_n=cal[best], month=bm, month_n=months[bm], longest=longest, lstart=lstart, lend=lend,
                weeks=weeks)


def render(s, t):
    from datetime import date
    w, h = CARD_W, CARD_H
    out = [card_open(t, label=f"{s['total']} contributions in the last 12 months")]
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Last 12 months</text>')
    rng = f"{fmt(s['first'])} to {fmt(s['last'])}"
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{esc(rng)}</text>')
    out.append(f'<text x="25" y="88" font-family="{FONT}" font-size="40" font-weight="700" fill="{t["text"]}">{s["total"]:,}</text>')
    out.append(f'<text x="26" y="108" font-family="{FONT}" font-size="12" fill="{t["muted"]}">contributions</text>')
    out.append(f'<text x="26" y="124" font-family="{FONT}" font-size="12" fill="{t["muted"]}">{s["active"]} active days of {s["n"]}</text>')
    month = date(*s["month"], 1).strftime("%B %Y")
    a, b = s["lstart"], s["lend"]
    if not s["longest"]:
        streak = "0 days"
    elif s["longest"] == 1:
        streak = f"1 day ({fmt(a)})"
    else:
        end = b.strftime("%-d, %Y") if a.month == b.month and a.year == b.year else fmt(b)
        streak = f"{s['longest']} days ({fmt(a, a.year != b.year)} to {end})"
    rows = [("Best day", f"{s['best_n']} on {fmt(s['best'])}" if s["best_n"] else "none yet"),
            ("Busiest month", f"{month} ({s['month_n']})" if s["month_n"] else "none yet"),
            ("Longest streak", streak)]
    x0, y0 = 170, 66
    for i, (k, v) in enumerate(rows):
        y = y0 + i * 24
        out.append(f'<circle cx="{x0+4}" cy="{y-4}" r="3" fill="{t["icon"]}"/>')
        out.append(f'<text x="{x0+14}" y="{y}" font-family="{FONT}" font-size="12.5" font-weight="600" fill="{t["text"]}">{esc(k)}:</text>')
        out.append(f'<text x="{x0+120}" y="{y}" font-family="{FONT}" font-size="12.5" font-weight="600" fill="{t["muted"]}">{esc(truncate(v, w-25-(x0+120), 12.5, bold=True))}</text>')
    # weekly bars along the bottom
    weeks = s["weeks"]
    bx, by, bw, bh = 25, h - 22, w - 50, 34
    peak = max(weeks) or 1
    step = bw / len(weeks)
    for i, v in enumerate(weeks):
        hh = max(1.5, bh * v / peak) if v else 1.5
        color = t["text"] if v else t["faint"]
        out.append(f'<rect x="{bx + i*step:.1f}" y="{by - hh:.1f}" width="{max(1.0, step-1.5):.1f}" height="{hh:.1f}" rx="1" fill="{color}" fill-opacity="{0.35 + 0.65*v/peak if v else 1:.2f}"/>')
    out.append("</svg>\n")
    return "\n".join(out)


def main():
    try:
        s = stats(contribution_calendar())
    except Exception as e:
        fail(str(e))
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"year-{name}.svg"), render(s, t))
    print(f"year card: {s['total']} contributions, best {s['best_n']} on {s['best']}, "
          f"month {s['month']} ({s['month_n']}), streak {s['longest']} ({s['lstart']} to {s['lend']})")


if __name__ == "__main__":
    main()
