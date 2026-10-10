"""All-time contributions card: every year since the account was created, summed from the public
contribution calendars (one request per year), with best year, best day, longest streak and per-year bars."""
import os
import re
from datetime import datetime, timedelta

from common import (ASSETS, CARD_H, CARD_W, FONT, IST, THEMES, USER, calendar_page, card_open, esc, fail, gh_api,
                    parse_calendar, truncate, write_atomic)


def fmt(d, year=True):
    return d.strftime("%b %-d, %Y") if year else d.strftime("%b %-d")


def all_days():
    joined = datetime.fromisoformat(gh_api(f"/users/{USER}")["created_at"].replace("Z", "+00:00")).astimezone(IST).date()
    today = datetime.now(IST).date()
    days, headers = {}, {}
    for y in range(joined.year, today.year + 1):
        page = calendar_page(f"?from={y}-01-01&to={y}-12-31")
        cal = parse_calendar(page)
        if len(cal) < 360:
            raise RuntimeError(f"{y} calendar looks incomplete ({len(cal)} days)")
        m = re.search(r"([\d,]+)\s+contributions?\s+in\s+" + str(y), page)
        headers[y] = int(m.group(1).replace(",", "")) if m else None
        days.update({d: n for d, n in cal.items() if d.year == y})
    days = {d: n for d, n in days.items() if joined <= d <= today}
    return joined, today, days, headers


def stats(joined, today, days):
    order = sorted(days)
    years = {}
    for d in order:
        years[d.year] = years.get(d.year, 0) + days[d]
    best = max(order, key=lambda d: (days[d], d))
    by = max(years, key=lambda y: (years[y], y))
    longest, run, start, ls, le = 0, 0, None, None, None
    prev = None
    for d in order:
        if days[d] > 0:
            run, start = (run + 1, start) if run and prev == d - timedelta(days=1) else (1, d)
            if run > longest:
                longest, ls, le = run, start, d
        else:
            run = 0
        prev = d
    return dict(joined=joined, today=today, total=sum(days.values()), active=sum(1 for n in days.values() if n),
                years=years, best_year=by, best=best, best_n=days[best], longest=longest, lstart=ls, lend=le)


def render(s, t):
    w, h = CARD_W, CARD_H
    out = [card_open(t, label=f"{s['total']} contributions since joining GitHub in {s['joined'].year}")]
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">All time</text>')
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">'
               f'member since {esc(fmt(s["joined"]))}</text>')
    out.append(f'<text x="25" y="88" font-family="{FONT}" font-size="40" font-weight="700" fill="{t["text"]}">{s["total"]:,}</text>')
    out.append(f'<text x="26" y="108" font-family="{FONT}" font-size="12" fill="{t["muted"]}">contributions</text>')
    out.append(f'<text x="26" y="124" font-family="{FONT}" font-size="12" fill="{t["muted"]}">{s["active"]:,} active days</text>')
    a, b = s["lstart"], s["lend"]
    if not s["longest"]:
        streak = "0 days"
    elif s["longest"] == 1:
        streak = f"1 day ({fmt(a)})"
    else:
        end = b.strftime("%-d, %Y") if (a.month, a.year) == (b.month, b.year) else fmt(b)
        streak = f"{s['longest']} days ({fmt(a, a.year != b.year)} to {end})"
    rows = [("Best year", f"{s['best_year']} ({s['years'][s['best_year']]:,})"),
            ("Best day", f"{s['best_n']} on {fmt(s['best'])}" if s["best_n"] else "none yet"),
            ("Best streak", streak)]
    x0, y0 = 170, 66
    for i, (k, v) in enumerate(rows):
        y = y0 + i * 24
        out.append(f'<circle cx="{x0+4}" cy="{y-4}" r="3" fill="{t["icon"]}"/>')
        out.append(f'<text x="{x0+14}" y="{y}" font-family="{FONT}" font-size="12.5" font-weight="600" fill="{t["text"]}">{esc(k)}:</text>')
        out.append(f'<text x="{x0+100}" y="{y}" font-family="{FONT}" font-size="12.5" font-weight="600" fill="{t["muted"]}">{esc(truncate(v, w-22-(x0+100), 12.5, bold=True))}</text>')
    # per-year bars: year label under each, count above
    ys = sorted(s["years"])
    bx, base, bh = 25, h - 24, 26
    slot = (w - 50) / len(ys)
    bw = min(56, slot - 10)
    peak = max(s["years"].values()) or 1
    for i, y in enumerate(ys):
        v = s["years"][y]
        cx = bx + slot * (i + 0.5)
        hh = max(2, bh * v / peak) if v else 2
        out.append(f'<rect x="{cx - bw/2:.1f}" y="{base - hh:.1f}" width="{bw:.1f}" height="{hh:.1f}" rx="2" '
                   f'fill="{t["icon"] if y == s["best_year"] else t["text"]}" fill-opacity="{0.4 + 0.6*v/peak if v else 0.25:.2f}"/>')
        label = f"{y}" + (" so far" if y == s["today"].year else "")
        out.append(f'<text x="{cx:.1f}" y="{h-10}" text-anchor="middle" font-family="{FONT}" font-size="10" fill="{t["muted"]}">{label}</text>')
        out.append(f'<text x="{cx + bw/2 + 3:.1f}" y="{base - 1:.1f}" font-family="{FONT}" font-size="9.5" fill="{t["muted"]}">{v:,}</text>')
    out.append("</svg>\n")
    return "\n".join(out)


def main():
    try:
        joined, today, days, headers = all_days()
        s = stats(joined, today, days)
    except Exception as e:
        fail(str(e))
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"alltime-{name}.svg"), render(s, t))
    check = ", ".join(f"{y}: {s['years'].get(y, 0)} (page says {headers[y]})" for y in sorted(headers))
    print(f"all-time card: {s['total']} since {joined}, best year {s['best_year']}, best day {s['best_n']} on "
          f"{s['best']}, streak {s['longest']} ({s['lstart']} to {s['lend']}); per year {check}")


if __name__ == "__main__":
    main()
