"""Visitor song: a small track made from notes and lyric lines that visitors add through an issue.

Separate from the contribution song. Visitors open an issue with the "visitor-note" template and pick a note,
an instrument and, if they like, one lyric line. Every night this script:
  1. reads open issues labelled visitor-note,
  2. checks each one (one per person per ISO week, line length, blocklist),
  3. appends accepted notes to the track and accepted lines to the lyrics (between the base lines),
  4. renders the song, the lyrics with credits (markdown + LRC) and a dark/light card.
The MP3 is not committed: the profile-cards workflow runs this with --rebuild and publishes it with the player.
With --reply (run after the push) it comments on each processed issue with a link to the second
their part plays, and closes it. Declined issues get a short, kind reason and are closed too.

Arrangement: 96 BPM, A minor, one visitor note per beat over a soft pad and a quiet kick on 1 and 3.
The song grows by one beat per note; each lyric line gets the bar its writer's note starts in.
State lives in data/visitor-song.json so a rerun never adds the same issue twice.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import song_synth as S  # noqa: E402
from common import (ASSETS, CARD_H, CARD_W, FONT, THEMES, USER, card_open, esc, fail,  # noqa: E402
                    write_atomic)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
STATE = os.path.join(ROOT, "data", "visitor-song.json")
BLOCKLIST = os.path.join(ROOT, "data", "visitor-song-blocklist.txt")
BASE_LYRICS = os.path.join(ASSETS, "visitor-song-base-lyrics.md")
PLAYER = f"https://{USER}.github.io/{USER}/player/"
LABEL = "visitor-note"

SR = S.SR
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
INTRO_BARS = 2
OUTRO_BARS = 2
MAX_LINE = 60

NOTES = {"A": 57, "B": 59, "C": 60, "D": 62, "E": 64, "F": 65, "G": 67, "A (high)": 69}
INSTRUMENTS = ("Piano", "Pluck", "Bell", "Bass", "Pad")
PROG = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]]  # Am7 Fmaj7 C G


# ---------- issues ----------

def gh(method, path, body=None):
    import urllib.request
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        fail("GITHUB_TOKEN is not set")
    req = urllib.request.Request("https://api.github.com" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}",
                                          "User-Agent": f"{USER}-visitor-song"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def open_issues():
    out, page = [], 1
    while True:
        batch = gh("GET", f"/repos/{USER}/{USER}/issues?labels={LABEL}&state=open&per_page=100&page={page}")
        out += [i for i in batch if "pull_request" not in i]
        if len(batch) < 100:
            return sorted(out, key=lambda i: i["created_at"])
        page += 1


def field(body, heading):
    """Issue forms render each field as '### Heading' followed by the answer."""
    m = re.search(rf"^###\s+{re.escape(heading)}\s*\n+(.*?)(?=\n###\s|\Z)", body or "", re.M | re.S)
    if not m:
        return ""
    v = m.group(1).strip()
    return "" if v == "_No response_" else v


# ---------- moderation ----------

LEET = str.maketrans("013457@$", "oieastas")


def load_blocklist():
    if not os.path.exists(BLOCKLIST):
        return []
    with open(BLOCKLIST) as f:
        return [w.strip().lower() for w in f if w.strip() and not w.startswith("#")]


def clean_line(s):
    s = re.sub(r"[\x00-\x1f<>`\[\]()*_#|\\]", "", s)   # no markup, links or control characters
    s = re.sub(r"https?://\S+|www\.\S+|@\w+", "", s)
    return re.sub(r"\s+", " ", s).strip()


def blocked(s, words):
    flat = s.lower().translate(LEET)
    squashed = re.sub(r"(.)\1+", r"\1", flat)
    return any(re.search(rf"\b{re.escape(w)}\b", t) for w in words for t in (flat, squashed))


def week_of(iso):
    y, w, _ = datetime.fromisoformat(iso.replace("Z", "+00:00")).isocalendar()
    return f"{y}-W{w:02d}"


def review(issue, state, words, taken):
    """Returns (entry, None) when accepted, or (None, reason) when declined."""
    user = issue["user"]["login"]
    if issue["user"].get("type") == "Bot":
        return None, "bot accounts can't add notes"
    week = week_of(issue["created_at"])
    if (user.lower(), week) in taken:
        return None, "there's already a note from you this week, so try again next week"
    body = issue.get("body") or ""
    note, inst = field(body, "Note"), field(body, "Instrument")
    if note not in NOTES or inst not in INSTRUMENTS:
        return None, "the note or instrument didn't come through, so please open a new one from the template"
    line = clean_line(field(body, "One lyric line (optional)"))
    if len(line) > MAX_LINE:
        return None, f"the lyric line is longer than {MAX_LINE} characters"
    if line and blocked(line, words):
        return None, "the lyric line didn't pass the word filter"
    taken.add((user.lower(), week))
    return dict(issue=issue["number"], user=user, week=week, note=note, instrument=inst, line=line or None,
                added=datetime.now(timezone.utc).strftime("%Y-%m-%d"), replied=False), None


# ---------- lyrics ----------

def base_sections():
    """the base lyrics: '## Section' headings with lines under them. Comments and blanks are skipped."""
    if not os.path.exists(BASE_LYRICS):
        return [("Opening", [])]
    with open(BASE_LYRICS) as f:
        text = re.sub(r"<!--.*?-->", "", f.read(), flags=re.S)
    secs = []
    for ln in text.splitlines():
        if ln.startswith("## "):
            secs.append((ln[3:].strip(), []))
        elif ln.strip() and secs:
            secs[-1][1].append(ln.strip())
    return secs or [("Opening", [])]


def lyric_sheet(entries):
    """Base lines first in each section, then visitor lines spread across sections in the order they arrived."""
    secs = base_sections()
    visitor = [e for e in entries if e["line"]]
    per = [visitor[i::len(secs)] for i in range(len(secs))]
    return [(name, [(l, "Nishal K") for l in base] + [(e["line"], "@" + e["user"], e) for e in per[i]])
            for i, (name, base) in enumerate(secs)]


def timed_sheet(entries):
    """Every lyric line, base or visitor, gets one bar in order, starting after the intro."""
    out, k = [], 0
    for name, lines in lyric_sheet(entries):
        for item in lines:
            out.append((name, item[0], item[1], item[2] if len(item) == 3 else None, INTRO_BARS * BAR + k * BAR))
            k += 1
    return out


# ---------- timing and audio ----------

def note_time(i):
    return INTRO_BARS * BAR + i * BEAT


def length(entries):
    lines = sum(len(l) for _, l in lyric_sheet(entries))
    bars = INTRO_BARS + max(-(-max(1, len(entries)) // 4), lines) + OUTRO_BARS
    return bars * BAR


def voice(inst, note, n):
    if inst == "Piano":
        return S.epiano(note, n, 0.55)
    if inst == "Pluck":
        return S.pluck(note, n, 0.5, bright=2200)
    if inst == "Bell":
        t = np.arange(n) / SR
        f = float(S.hz(note + 12))
        return 0.35 * np.sin(2 * np.pi * f * t + 1.4 * np.sin(2 * np.pi * f * 3.5 * t) * S.env(n, 0.4)) * S.env(n, 1.2)
    if inst == "Bass":
        return S.pluck(note - 24, n, 0.6, bright=600)
    return S.warm_pad([note], n, cutoff=1400).mean(axis=0) * 0.5  # mono, panned by the caller


def render(entries):
    total = length(entries)
    n = int(total * SR) + SR
    mix = np.zeros((2, n))
    bars = int(round(total / BAR))
    for b in range(bars):
        chord = PROG[b % 4]
        S.add(mix, S.warm_pad(chord, int(BAR * SR), cutoff=900) * 0.18, b * BAR)  # already stereo
        for beat in (0, 2):
            S.add(mix, S.pan(S.kick(0.35), 0.0), b * BAR + beat * BEAT)
        for beat, k in ((0, 0), (1.5, 2), (3, 1)):  # a quiet piano figure from the chord, so the song plays on its own
            x = S.epiano(chord[k] + 12, int(BEAT * 1.4 * SR), 0.22)
            S.add(mix, S.pan(x, -0.2 + 0.2 * k), b * BAR + beat * BEAT)
    for i, e in enumerate(entries):
        x = voice(e["instrument"], NOTES[e["note"]], int(BEAT * 1.6 * SR))
        S.add(mix, S.pan(x * 0.6, ((i * 7) % 11) / 10 - 0.5), note_time(i))  # add() takes seconds
    mix = mix + 0.25 * S.reverb(mix, 2.6, 0.6)
    # bring it up to about the loudness of the contribution song (-15 dBFS mean): gain, limit, measure, repeat
    for _ in range(3):
        rms = float(np.sqrt(np.mean(mix ** 2))) or 1e-9
        mix = S.limit(mix * min(30.0, 10 ** (-15 / 20) / rms), -1.0)
    return mix[:, : int(total * SR)]


def encode_mp3(stereo, path):
    from scipy.io import wavfile
    with tempfile.TemporaryDirectory() as d:
        wav, mp3 = os.path.join(d, "s.wav"), os.path.join(d, "s.mp3")
        wavfile.write(wav, SR, (np.clip(stereo.T, -1, 1) * 32767).astype(np.int16))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "128k",
                        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", mp3], check=True)
        with open(mp3, "rb") as f:
            write_atomic(path, f.read())


# ---------- outputs ----------

def mmss(t):
    return f"{int(t // 60)}:{int(t % 60):02d}"


def part_link(i):
    return f"{PLAYER}?song=visitor&t={int(note_time(i))}"


def lyrics_md(entries):
    out = ["# Visitor song", "",
           "A song made by people who visit this profile. Base lyrics by Nishal K. Every other line is credited to the person who wrote it.",
           f"[Add a note](https://github.com/{USER}/{USER}/issues/new?template=visitor-note.yml) · "
           f"[Listen]({PLAYER}?song=visitor)", ""]
    section = None
    for name, text, who, e, t in timed_sheet(entries):
        if name != section:
            out += [f"## {name}", ""]
            section = name
        link = f"[{mmss(t)}]({PLAYER}?song=visitor&t={int(t)})"
        out += [f"{esc(text)}  \n<sub>lyric: {who} · {link}</sub>  ", ""]
    out += ["## Credits", "", "**Lyrics:** Nishal K (base lyrics)" +
            "".join(f", @{e['user']}" for e in entries if e["line"]), "",
            "**Notes, in the order they play:**", ""]
    out += [f"{i + 1}. @{e['user']} · {e['note']} on {e['instrument'].lower()} · [{mmss(note_time(i))}]({part_link(i)})"
            for i, e in enumerate(entries)]
    return "\n".join(out) + "\n"


def lyrics_lrc(entries):
    out = ["[ti:Visitor song]", f"[ar:{USER} and visitors]"]
    out += [f"[{int(t // 60):02d}:{t % 60:05.2f}]{text} ({who})" for _, text, who, _, t in timed_sheet(entries)]
    return "\n".join(out) + "\n"


def line_time(entries, issue):
    return next((t for _, _, _, e, t in timed_sheet(entries) if e and e["issue"] == issue), None)


def card(theme, entries):
    t = THEMES[theme]
    total = length(entries)
    people = len({e["user"].lower() for e in entries})
    lines = sum(1 for e in entries if e["line"])
    label = f"Visitor song · {mmss(total)} · {len(entries)} notes from {people} people"
    s = [card_open(t, label=label)]
    s.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Visitor song</text>')
    s.append(f'<text x="470" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">'
             f'96 BPM · A minor · 1 beat = 1 visitor</text>')
    # a quiet piano roll: one short bar per note, height by pitch, latest few in the accent colour
    shown = entries[-54:]
    x0, w, gap = 25, 6.2, 1.9
    for i, e in enumerate(shown):
        y = 108 - (NOTES[e["note"]] - 57) * 5.2
        recent = i >= len(shown) - 4
        s.append(f'<rect x="{x0 + i * (w + gap):.1f}" y="{y:.1f}" width="{w}" height="4" rx="1" '
                 f'fill="{t["text"] if recent else t["muted"]}" fill-opacity="{0.9 if recent else 0.45}"/>')
    for i in range(len(shown), 54):  # empty slots waiting for the next visitors
        s.append(f'<rect x="{x0 + i * (w + gap):.1f}" y="108" width="{w}" height="2" rx="1" fill="{t["muted"]}" fill-opacity="0.18"/>')
    s.append(f'<line x1="25" y1="126" x2="470" y2="126" stroke="{t["faint"]}" stroke-width="1"/>')
    if entries:
        last = entries[-1]
        latest = f'Latest: @{last["user"]}, {last["note"]} on {last["instrument"].lower()}'
        if last["line"]:
            latest += f', "{last["line"]}"'
    else:
        latest = "No notes yet. Yours could be the first."
    from common import truncate
    s.append(f'<text x="25" y="148" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{esc(truncate(latest, 445, 11))}</text>')
    s.append(f'<text x="25" y="177" font-family="{FONT}" font-size="11.5" fill="{t["text"]}"><tspan font-weight="700">'
             f'{mmss(total)}</tspan> · {len(entries)} notes · {people} people · {lines} lyric lines</text>')
    s.append(f'<text x="470" y="177" text-anchor="end" font-family="{FONT}" font-size="10" fill="{t["muted"]}">'
             f'open an issue to add a note</text>')
    return "\n".join(s) + "\n</svg>\n"


def player_json(entries, audio_buf=None):
    """Same shape as contribution-song.json, so the player page draws the visitor song with ?song=visitor.
    One "week" in the player is one bar here, and its days are the four beats (how many notes land on each)."""
    total = length(entries)
    bars = int(round(total / BAR))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    first = entries[0]["added"] if entries else today
    beats = [[0] * 7 for _ in range(bars)]
    for i in range(len(entries)):
        t = note_time(i)
        beats[int(t // BAR)][int(round((t % BAR) / BEAT)) % 4] += 1
    sheet = timed_sheet(entries)
    lines = [dict(t=round(t, 3), end=round(t + BAR * 0.92, 3), section=name,
                  text=text if who == "Nishal K" else f"{text} ({who})") for name, text, who, _, t in sheet]
    secs = [dict(name="Intro", start=0.0, bars=INTRO_BARS)]
    for name, _, _, _, t in sheet:
        if secs[-1]["name"] != name:
            secs.append(dict(name=name, start=round(t, 3), bars=0))
    secs.append(dict(name="Fade out", start=round(total - OUTRO_BARS * BAR, 3), bars=OUTRO_BARS))
    for a, b in zip(secs, secs[1:] + [dict(start=total)]):
        a["bars"] = max(1, int(round((b["start"] - a["start"]) / BAR)))
    peaks = [0.0] * 400
    if audio_buf is not None:
        m = np.abs(audio_buf).max(axis=0)
        k = max(1, len(m) // 400)
        peaks = [round(float(m[i * k:(i + 1) * k].max() if len(m[i * k:(i + 1) * k]) else 0), 3) for i in range(400)]
    people = sorted({x["user"] for x in entries}, key=str.lower)
    return dict(
        title="Visitor song", artist="Nishal K and visitors", length=round(total, 3), bpm=BPM, key="A minor",
        bar=round(BAR, 6), generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), unit="note", per="bar",
        rules=[dict(name="note", min=1)], sections=secs, lines=lines, peaks=peaks,
        weeks=[dict(start=today, days=d, lang=None, events=[]) for d in beats],
        stats=dict(total=len(entries), active=len(people), days=len(entries), first=first, last=today, best=today,
                   best_n=len(entries), month=today[:7], month_n=len(entries), streak=0, streak_start=today,
                   streak_end=today, recent=["@" + p for p in people[-3:]], langs=[]),
        items=[["Notes", len(entries), "one beat each"], ["People", len(people), "one note a week each"],
               ["Lyric lines", sum(1 for x in entries if x["line"]), "credited by name"],
               ["Length", mmss(total), f"{BPM} BPM, A minor"]],
        about=("This song is made by people who visit my GitHub profile. Each visitor adds one note, and can add one line "
               "to the lyrics with their name next to it. A GitHub Action adds new notes every night."),
        add=f"https://github.com/{USER}/{USER}/issues/new?template=visitor-note.yml",
        notes=[dict(t=round(note_time(i), 3), user=x["user"], note=x["note"], instrument=x["instrument"], line=x["line"])
               for i, x in enumerate(entries)])


# ---------- main ----------

def load_state():
    if os.path.exists(STATE):
        with open(STATE) as f:
            return json.load(f)
    return {"entries": [], "declined": []}


def build(state, audio=True):
    e = state["entries"]
    write_atomic(os.path.join(ASSETS, "visitor-song-lyrics.md"), lyrics_md(e))
    write_atomic(os.path.join(ASSETS, "visitor-song.lrc"), lyrics_lrc(e))
    for th in ("dark", "light"):
        write_atomic(os.path.join(ASSETS, f"visitor-song-{th}.svg"), card(th, e))
    audio_buf = None
    if audio:
        if not shutil.which("ffmpeg"):
            fail("ffmpeg not found")
        audio_buf = render(e)
        encode_mp3(audio_buf, os.path.join(ASSETS, "visitor-song.mp3"))
    write_atomic(os.path.join(ASSETS, "visitor-song.json"), json.dumps(player_json(e, audio_buf), separators=(",", ":")))


def collect(state):
    words = load_blocklist()
    seen = {x["issue"] for x in state["entries"]} | {x["issue"] for x in state["declined"]}
    taken = {(x["user"].lower(), x["week"]) for x in state["entries"]}
    for issue in open_issues():
        if issue["number"] in seen:
            continue
        entry, reason = review(issue, state, words, taken)
        if entry:
            state["entries"].append(entry)
        else:
            state["declined"].append(dict(issue=issue["number"], user=issue["user"]["login"], reason=reason, replied=False))


def reply(state):
    idx = {x["issue"]: i for i, x in enumerate(state["entries"])}
    for x in state["entries"]:
        if x["replied"]:
            continue
        i = idx[x["issue"]]
        msg = (f"Thanks @{x['user']}, your {x['note']} on {x['instrument'].lower()} is in the visitor song now. "
               f"It plays at [{mmss(note_time(i))}]({part_link(i)}).")
        if x["line"]:
            lt = line_time(state["entries"], x["issue"])
            msg += (f'\n\nYour line "{x["line"]}" is in the lyrics with your name next to it, '
                    f'at [{mmss(lt)}]({PLAYER}?song=visitor&t={int(lt)}).')
        gh("POST", f"/repos/{USER}/{USER}/issues/{x['issue']}/comments", {"body": msg})
        gh("PATCH", f"/repos/{USER}/{USER}/issues/{x['issue']}", {"state": "closed", "state_reason": "completed"})
        x["replied"] = True
    for x in state["declined"]:
        if x["replied"]:
            continue
        gh("POST", f"/repos/{USER}/{USER}/issues/{x['issue']}/comments",
           {"body": f"Thanks for stopping by, @{x['user']}. I couldn't add this one: {x['reason']}."})
        gh("PATCH", f"/repos/{USER}/{USER}/issues/{x['issue']}", {"state": "closed", "state_reason": "not_planned"})
        x["replied"] = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reply", action="store_true", help="comment on and close processed issues (run after the push)")
    ap.add_argument("--from", dest="fixture", help="build from a local state file instead of reading issues")
    ap.add_argument("--rebuild", action="store_true", help="rebuild the song from data/visitor-song.json without reading issues")
    ap.add_argument("--no-audio", action="store_true")
    a = ap.parse_args()
    if a.fixture:
        with open(a.fixture) as f:
            build(json.load(f), audio=not a.no_audio)
        return
    state = load_state()
    if a.rebuild:
        build(state, audio=not a.no_audio)
        return
    if a.reply:
        reply(state)
    else:
        collect(state)
        build(state, audio=not a.no_audio)
    write_atomic(STATE, json.dumps(state, indent=1))


if __name__ == "__main__":
    main()
