"""Lyrics for the contribution song, filled in from the stats. Pure Python so it can be tested without audio.

Every line is (display, spoken, mode): display goes to the lyrics page/LRC/JSON (digits, real repo names),
spoken is what the voice says (numbers as words, respelled names), mode is rap, sing or spoken.
Zero, one and many each get their own wording, so the grammar holds for any year. The sung parts have no
numbers or names: they are the same every night and are written for singing (open vowels, few s/sh endings).
"""
import re
from datetime import date

NISHAL = "[[nɪʃˈɑːl]]"  # nih-SHAAL

CHORUS = [
    "Light up the grid, let the green glow",
    "Every week is a bar, every day is a note",
    "Turn it up loud, let the bass line roll",
    "Run it back tomorrow, here we go",
]
BREAKDOWN = "Light weeks play low, heavy weeks play loud"

# words Piper gets wrong, as respellings or raw phonemes; checked by transcribing the result
PRONOUNCE = {
    "nishal": NISHAL, "nishal21": NISHAL, "neko": "Neck-oh", "nekodroid": "Neck-oh droid",
    "upi": "[[jˈuː pˈiː ˈaɪ]]", "amv": "A M V", "cli": "C L I", "api": "A P I", "ui": "U I", "ai": "A I", "js": "J S",
    "ts": "T S", "io": "I O", "db": "D B", "gpt": "G P T", "llm": "L L M", "md": "M D", "npm": "N P M",
    "css": "C S S", "html": "H T M L", "sql": "sequel", "gui": "gooey", "url": "U R L", "pwa": "P W A",
}
LANG_SAY = {
    "C++": "C plus plus", "C#": "C sharp", "F#": "F sharp", "Objective-C": "Objective C",
    "Jupyter Notebook": "Jupyter", "HTML": "H T M L", "CSS": "C S S", "SCSS": "S C S S", "PHP": "P H P",
    "Vim Script": "Vim script", "MDX": "M D X", "HCL": "H C L", "QML": "Q M L", "GLSL": "G L S L",
    "SQL": "sequel", "TSQL": "T sequel", "PLpgSQL": "Postgres", "Dockerfile": "Docker", "Makefile": "Make",
    "CMake": "C Make", "Batchfile": "batch", "TeX": "tech", "R": "R", "JavaScript": "JavaScript",
    "TypeScript": "TypeScript", "CoffeeScript": "CoffeeScript", "PowerShell": "PowerShell",
}

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
ORD = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth",
       "twelve": "twelfth"}


def _two(n):
    return ONES[n] if n < 20 else TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")


def _three(n):
    h, r = divmod(n, 100)
    return _two(r) if not h else f"{ONES[h]} hundred" + (f" {_two(r)}" if r else "")


def num_words(n):
    """844 -> eight hundred forty-four, 2000 -> two thousand, 1205 -> twelve oh five, 12345 -> twelve thousand
    three hundred forty-five. Four-digit numbers are read in pairs like a year (shorter to rap)."""
    n = int(n)
    if n < 1000:
        return _three(n)
    if n < 10000 and n % 1000 and (n // 100) % 10:
        hi, lo = divmod(n, 100)
        return f"{_two(hi)} " + (_two(lo) if lo >= 10 else f"oh {ONES[lo]}" if lo else "hundred")
    if n < 1_000_000:
        th, r = divmod(n, 1000)
        return f"{_three(th)} thousand" + (f" {_three(r)}" if r else "")
    m, r = divmod(n, 1_000_000)
    return f"{_three(m)} million" + (f" {num_words(r)}" if r else "")


def ordinal_words(n):
    w = _two(n).split("-")
    last = w[-1]
    w[-1] = ORD.get(last, last[:-1] + "ieth" if last.endswith("y") else last + "th")
    return "-".join(w)


def year_words(y):
    hi, lo = divmod(y, 100)
    if lo == 0:
        return f"{ONES[y // 1000]} thousand" if y % 1000 == 0 else f"{_two(hi)} hundred"
    if 2000 < y < 2010:
        return f"two thousand {ONES[lo]}"
    return f"{_two(hi)} " + (_two(lo) if lo >= 10 else f"oh {ONES[lo]}")


def fmt(n):
    return f"{n:,}"


def _syl(word):
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 1
    n = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and not w.endswith(("le", "ee", "ye")) and n > 1:
        n -= 1
    return max(1, n)


def syllables(text):
    t = re.sub(r"\[\[.*?\]\]", "xa xa", text)
    return sum(_syl(w) for w in re.findall(r"[A-Za-z']+", t))


def say_name(name):
    """Spoken form of a repo name, or None when it would be hard to rap (very long, no vowels, long numbers)."""
    low = name.lower()
    if low in PRONOUNCE:
        return PRONOUNCE[low]
    parts = []
    for part in re.split(r"[-_. ]+", name):
        if not part:
            continue
        if part.lower() in PRONOUNCE:
            parts.append(PRONOUNCE[part.lower()])
            continue
        for w in re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+", part) or [part]:
            lw = w.lower()
            if lw in PRONOUNCE:
                parts.append(PRONOUNCE[lw])
            elif w.isdigit():
                if len(w) > 4:
                    return None
                parts.append(num_words(int(w)) if len(w) < 4 else year_words(int(w)))
            elif re.fullmatch(r"v\d*", lw):
                parts.append("V")
            elif (w.isupper() and len(w) <= 4) or (len(w) <= 3 and not re.search(r"[aeiouy]", lw)):
                parts.append(" ".join(w.upper()))  # acronym: spell it
            elif not re.search(r"[aeiouy]", lw) or len(w) > 14:
                return None
            else:
                parts.append(w)
    words = " ".join(parts).split()
    if not words or len(words) > 6 or syllables(" ".join(parts)) > 7:
        return None
    return " ".join(parts)


def say_lang(lang):
    return LANG_SAY.get(lang) or say_name(lang)


MAX_RAP_SYL = 17  # a rap line gets 2 bars; past this the voice rushes and words get lost in the mix


def fit(*cands):
    """First (display, spoken, mode) candidate short enough to rap in two bars; the last one otherwise."""
    for c in cands:
        if syllables(c[1]) <= MAX_RAP_SYL:
            return c
    return cands[-1]


def build_lyrics(s, facts, user):
    """s: year_card.stats(); facts: repo_facts() or None. Returns {section: [(display, spoken, mode)]}."""
    def L(d, sp=None, mode="rap"):
        return (d, sp or d, mode)

    total, active, streak = s["total"], s["active"], s["longest"]
    since_d = f"since {s['first']:%B %Y}"
    since_s = f"since {s['first']:%B} {year_words(s['first'].year)}"

    # Verse 1: lines 2 and 4 rhyme
    if total == 0:
        v1 = [L(f"Not one contribution {since_d}", f"Not one contribution {since_s}"),
              L("Not a single green square, the grid stayed gray"),
              L("Every month was quiet on the sheet"),
              L("But the beat keeps going anyway")]
    else:
        noun = "contribution" if total == 1 else "contributions"
        v1 = [fit(L(f"{fmt(total)} {noun} {since_d}", f"{num_words(total)} {noun} {since_s}"),
                  L(f"{fmt(total)} {noun} in twelve months", f"{num_words(total)} {noun} in twelve months"),
                  L(f"{fmt(total)} in twelve months", f"{num_words(total)} in twelve months"))]
        bn, best = s["best_n"], s["best"]
        if active == 1:
            v1.append(L(f"One green square on {best:%B} {best.day}, and that was the day",
                        f"One green square on {best:%B} {ordinal_words(best.day)}, and that was the day"))
        elif bn == 1:
            v1.append(L(f"{fmt(active)} days on the board, never more than one a day",
                        f"{num_words(active)} days on the board, never more than one a day"))
        else:
            v1.append(fit(L(f"{fmt(active)} days on the board, {fmt(bn)} on my biggest day",
                            f"{num_words(active)} days on the board, {num_words(bn)} on my biggest day"),
                          L(f"{fmt(active)} days on the board, best day {fmt(bn)}",
                            f"{num_words(active)} days on the board, best day {num_words(bn)}"),
                          L(f"{fmt(active)} active days, best day {fmt(bn)}",
                            f"{num_words(active)} active days, best day {num_words(bn)}")))
        month, mn = date(*s["month"], 1).strftime("%B"), s["month_n"]
        if mn == total and active > 1:
            v1.append(L(f"All of it landed in {month}, every one on the sheet"))
        elif mn == 1:
            v1.append(L(f"{month} got one, and it's there on the sheet"))
        elif mn >= 50:
            v1.append(fit(L(f"{month} ran hot with {fmt(mn)} on the sheet", f"{month} ran hot with {num_words(mn)} on the sheet"),
                          L(f"{month} ran hot with {fmt(mn)}", f"{month} ran hot with {num_words(mn)}")))
        else:
            v1.append(L(f"{month} was the busiest, {mn} on the sheet", f"{month} was the busiest, {num_words(mn)} on the sheet"))
        if streak >= 2:
            v1.append(fit(L(f"{fmt(streak)} days straight, no breaks along the way",
                            f"{num_words(streak)} days straight, no breaks along the way"),
                          L(f"{fmt(streak)} days straight, every single day",
                            f"{num_words(streak)} days straight, every single day")))
        else:
            v1.append(L("Never two in a row, but I came back anyway") if active > 1
                      else L("It's a start, and there's more on the way"))

    # Verse 2: lines 2 and 4 rhyme
    facts = facts or {}
    named = [(r, say_name(r)) for r in facts.get("recent") or []]
    named = [x for x in named if x[1]][:2]
    if len(named) == 2:
        (a, sa), (b, sb) = named
        v2 = [L(f"Right now I'm deep in {a} and {b}", f"Right now I'm deep in {sa} and {sb}")]
    elif len(named) == 1:
        (a, sa), = named
        tail = "" if a.lower().endswith("repo") else " repo"
        v2 = [L(f"Right now I'm deep in the {a}{tail}", f"Right now I'm deep in the {sa}{tail}")]
    elif len(facts.get("recent") or []) >= 2:
        v2 = [L("Right now I'm deep in repos with names too hard to rap")]
    elif facts.get("recent"):
        v2 = [L("Right now I'm deep in a repo with a name too hard to rap")]
    elif not facts:
        v2 = [L("Right now I'm heads-down in the code")]
    elif total:
        v2 = [L("Right now I'm out there in other people's repos")]
    else:
        v2 = [L("Right now the board is quiet, nothing new of late")]
    n_own = facts.get("n_own", 0)
    langs = [(x, say_lang(x)) for x in facts.get("langs") or []]
    langs = [x for x in langs if x[1]][:2]
    if n_own == 0:
        v2.append(L("No repos of my own yet, I'm taking my time"))
    elif n_own == 1:
        v2.append(L(f"One repo of my own, in {langs[0][0]}, one line at a time",
                    f"One repo of my own, in {langs[0][1]}, one line at a time") if langs
                  else L("One repo of my own, one line at a time"))
    elif len(langs) >= 2:
        v2.append(fit(L(f"{fmt(n_own)} repos of my own, {langs[0][0]} and {langs[1][0]} most of the time",
                        f"{num_words(n_own)} repos of my own, {langs[0][1]} and {langs[1][1]} most of the time"),
                      L(f"{fmt(n_own)} repos, {langs[0][0]} and {langs[1][0]} most of the time",
                        f"{num_words(n_own)} repos, {langs[0][1]} and {langs[1][1]} most of the time"),
                      L(f"{fmt(n_own)} repos, {langs[0][0]} most of the time",
                        f"{num_words(n_own)} repos, {langs[0][1]} most of the time")))
    elif langs:
        v2.append(fit(L(f"{fmt(n_own)} repos of my own, {langs[0][0]} most of the time",
                        f"{num_words(n_own)} repos of my own, {langs[0][1]} most of the time"),
                      L(f"{fmt(n_own)} repos, {langs[0][0]} most of the time",
                        f"{num_words(n_own)} repos, {langs[0][1]} most of the time")))
    else:
        v2.append(L(f"{fmt(n_own)} repos of my own, built one at a time",
                    f"{num_words(n_own)} repos of my own, built one at a time"))
    v2 += [L("Cut it like an AMV, every frame in place", "Cut it like an A M V, every frame in place"),
           L("Mix it like a mashup, every verse in rhyme")]

    if total:
        noun = "contribution" if total == 1 else "contributions"
        outro1 = L(f"That was {fmt(total)} {noun} from {user}", f"That was {num_words(total)} {noun} from {NISHAL if user.lower().startswith('nishal') else say_name(user) or user}.", "spoken")
    else:
        outro1 = L(f"That was a quiet year from {user}", f"That was a quiet year from {NISHAL if user.lower().startswith('nishal') else say_name(user) or user}.", "spoken")
    who = NISHAL if user.lower().startswith("nishal") else (say_name(user) or user)
    return {
        "Intro": [L(f"{user}. Twelve months, every week one bar", f"{who}. Twelve months. Every week, one bar.", "spoken")],
        "Verse 1": v1,
        "Chorus": [L(x, mode="sing") for x in CHORUS],
        "Verse 2": v2,
        "Breakdown": [L(BREAKDOWN, mode="sing")],
        "Outro": [outro1, L("Tomorrow the numbers change, and the song does too", mode="spoken")],
    }
