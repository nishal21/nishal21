"""Generate lyrics for many synthetic years (edge cases included) and check them.

Run: python scripts/test_song_lyrics.py [out.md]   (stdlib only). Fails if a line breaks a rule."""
import re
import sys
from datetime import date, timedelta

import song_lyrics as T

BAR = 4 * 60 / 140
MAX_RAP_SYL = T.MAX_RAP_SYL


def stats(total, active, best_n, month_n, streak, month=(2026, 2), best=date(2026, 2, 17), first=date(2025, 10, 5)):
    return dict(total=total, active=active, best=best, best_n=best_n, month=month, month_n=month_n, longest=streak,
                first=first, last=first + timedelta(days=370), n=371)


def F(recent=(), n_own=0, langs=()):
    return dict(recent=list(recent), n_own=n_own, langs=list(langs))


CASES = [
    ("tonight's real data", stats(844, 144, 27, 134, 11, best=date(2026, 10, 6)),
     F(["upi-Down", "NekoDroid", "musabaka-result"], 62, ["JavaScript", "TypeScript"])),
    ("empty year, no repos", stats(0, 0, 0, 0, 0), F()),
    ("empty year, repo list failed", stats(0, 0, 0, 0, 0), None),
    ("one contribution", stats(1, 1, 1, 1, 1, month=(2026, 1), best=date(2026, 1, 9)), F(["hello-world"], 1, ["HTML"])),
    ("two on one day", stats(2, 1, 2, 2, 1, month=(2026, 3), best=date(2026, 3, 1)), F(["dotfiles"], 1, ["Shell"])),
    ("two on two days apart", stats(2, 2, 1, 1, 1, month=(2026, 3)), F(["dotfiles"], 1, [])),
    ("five, scattered", stats(5, 5, 1, 2, 1), F(["notes"], 2, ["Python"])),
    ("five in one month", stats(5, 3, 3, 5, 2, month=(2026, 7), best=date(2026, 7, 2)), F(["site"], 1, ["CSS"])),
    ("thirteen, short streak", stats(13, 9, 3, 6, 2), F(["a", "b"], 2, ["Go", "Rust"])),
    ("21, exactly one per day max", stats(21, 21, 1, 7, 5), F(["cli-tool"], 3, ["Go"])),
    ("100 round", stats(100, 40, 12, 30, 4), F(["API_v3", "go"], 3, ["Go"])),
    ("busy month exactly 50", stats(300, 90, 15, 50, 6), F(["blog", "infra"], 12, ["TypeScript"])),
    ("1,000", stats(1000, 200, 40, 160, 21), F(["ml-notes", "PaperReader"], 30, ["Jupyter Notebook", "Python"])),
    ("1,205 odd number", stats(1205, 230, 33, 190, 9), F(["react-native-app"], 18, ["TypeScript", "Kotlin"])),
    ("2,000 round", stats(2000, 300, 60, 400, 30), F(["kernel-patches"], 5, ["C", "C++"])),
    ("2,050", stats(2050, 310, 61, 410, 31), F(["x"], 4, ["C"])),
    ("9,999", stats(9999, 360, 210, 1500, 200), F(["monorepo"], 120, ["Java", "Kotlin"])),
    ("12,345 huge, odd names", stats(12345, 365, 311, 2100, 365, first=date(2025, 10, 1)),
     F(["my-super-long-experimental-repository-name-v2", "xkcd-bot"], 1, ["C++", "Jupyter Notebook"])),
    ("100,000 bot-like", stats(100000, 366, 900, 9000, 366), F(["auto-commits"], 2, ["Shell"])),
    ("one hard name, one easy", stats(400, 100, 9, 60, 7), F(["xkcd-bot", "weather-app"], 6, ["Vue", "SCSS"])),
    ("both names unsayable", stats(400, 100, 9, 60, 7), F(["zzxq", "qwrtp-v12345"], 6, ["C#"])),
    ("lowercase long-ish names", stats(250, 80, 8, 40, 5), F(["awesome-python-scripts-collection", "dotfiles"], 9, ["Python"])),
    ("camelCase and digits", stats(320, 110, 10, 45, 8), F(["myPortfolio2024", "todoApp"], 14, ["JavaScript", "CSS"])),
    ("dots in name", stats(77, 30, 6, 20, 3), F(["nishal21.github.io"], 3, ["HTML"])),
    ("acronyms", stats(510, 130, 14, 70, 10), F(["CLI-UI", "llm-eval"], 20, ["Python", "PLpgSQL"])),
    ("no languages detected", stats(60, 25, 5, 15, 3), F(["docs", "notes"], 4, [])),
    ("one repo, no language", stats(60, 25, 5, 15, 3), F(["docs"], 1, [])),
    ("forks only (0 own repos)", stats(45, 20, 4, 12, 2), F([], 0, [])),
    ("one own repo many langs", stats(150, 60, 7, 30, 4), F(["engine"], 1, ["Rust", "WGSL"])),
    ("streak of exactly 2", stats(40, 30, 3, 10, 2), F(["game"], 2, ["Lua"])),
    ("long streak, quiet best", stats(365, 365, 1, 31, 365), F(["daily-log"], 1, ["Markdown"])),
    ("first date in 2009", stats(90, 40, 5, 20, 3, first=date(2009, 3, 1)), F(["old-project"], 2, ["Perl"])),
    ("first date in 2000", stats(90, 40, 5, 20, 3, first=date(2000, 1, 2)), F(["y2k"], 2, ["COBOL"])),
    ("best day on the 22nd", stats(500, 120, 22, 88, 12, best=date(2026, 5, 22), month=(2026, 5)), F(["shop"], 8, ["PHP"])),
    ("best day on the 31st", stats(500, 120, 23, 88, 12, best=date(2026, 8, 31), month=(2026, 8)), F(["shop"], 8, ["Ruby"])),
    ("other user name", stats(844, 144, 27, 134, 11), F(["upi-Down"], 62, ["JavaScript"])),
]

BANNED = re.compile(r"\b(delve|leverage|robust|seamless|showcase|unlock|empower|journey|testament|vibrant)\b", re.I)


def check(lyr):
    problems = []
    for sec, lines in lyr.items():
        for d, sp, mode in lines:
            if re.search(r"(?<![\d,])1 (contributions|days|repos)\b|(?<![-\w])one (contributions|days|repos)\b", d + " " + sp):
                problems.append(f"plural with one: {d}")
            if re.search(r"\b0\b", d):
                problems.append(f"bare zero: {d}")
            if "{" in d or "None" in d or "None" in sp:
                problems.append(f"template leak: {d}")
            if BANNED.search(d):
                problems.append(f"banned word: {d}")
            if "—" in d:
                problems.append(f"em dash: {d}")
            if mode == "rap" and T.syllables(sp) > MAX_RAP_SYL:
                problems.append(f"too long to rap in 2 bars ({T.syllables(sp)} syllables): {sp}")
            if mode == "sing" and re.search(r"\d", d):
                problems.append(f"number in a sung line: {d}")
    return problems


def main(out=None):
    md = ["# Contribution song lyrics: samples", "",
          f"Generated by `scripts/test_song_lyrics.py` from {len(CASES)} synthetic years. The chorus and breakdown "
          "are the same every night, so they are printed once.", "", "## Chorus (every song)", ""]
    md += [f"{x}  " for x in T.CHORUS] + ["", f"Breakdown: {T.BREAKDOWN}", ""]
    bad = 0
    for name, s, facts in CASES:
        user = "octocat" if name == "other user name" else "nishal21"
        lyr = T.build_lyrics(s, facts, user)
        probs = check(lyr)
        bad += len(probs)
        recent = ", ".join((facts or {}).get("recent", [])) or "none"
        md += [f"## {name}", "",
               f"total {s['total']}, active {s['active']}, best {s['best_n']}, busiest month {s['month_n']}, "
               f"streak {s['longest']}, own repos {(facts or {}).get('n_own', 'n/a')}, recent: {recent}, "
               f"langs: {', '.join((facts or {}).get('langs', [])) or 'none'}", ""]
        for sec in ("Intro", "Verse 1", "Verse 2", "Outro"):
            for d, sp, mode in lyr[sec]:
                extra = f"  *(says: {sp})*" if sp != d and mode != "sing" else ""
                md.append(f"- **{sec}**: {d}{extra}")
        md += [f"- PROBLEM: {p}" for p in probs] + [""]
    text = "\n".join(md) + "\n"
    if out:
        with open(out, "w") as f:
            f.write(text)
    print(f"{len(CASES)} cases, {bad} problems")
    return bad


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
