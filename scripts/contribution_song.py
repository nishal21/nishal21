"""Contribution song: the last 12 months of contributions as a ~90 second track with vocals.

Arrangement: 53 bars at 140 BPM (half-time), one bar per week of the contribution calendar, in order:
  Intro 4 | Verse 1 8 | Build 2 | Chorus 8 | Hook 4 | Verse 2 8 | Breakdown 4 | Build 2 | Chorus 8 | Outro 5
Each week's total sets how busy its bar is: hat density and rolls, extra kicks, 808 pattern and glides,
pad brightness, key and pluck note counts. Every day also triggers the commit-beat rules on top
(kick 1+, hat 3+, snare 6+, clap 10+), louder on busier days.

Vocals (song_vocals.py): two Piper voices at their natural pitch. One raps the verses; the other chants the
chorus and breakdown on the beat while the synth lead carries the hook melody and answers the rap lines.
Timing comes only from Piper's own speed setting; vocal processing is EQ, compression, de-essing, a short
room and delay throws. Instruments and mixing live in song_synth.py.
Outputs: MP3, lyrics (markdown + LRC), JSON for the player page, and a dark/light card.
"""
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

import numpy as np
from scipy import signal

import song_synth as S
import song_lyrics as LY
import song_vocals as V
from common import (ASSETS, CARD_H, CARD_W, FONT, THEMES, USER, card_open, contribution_calendar, esc, fail,
                    gh_api, write_atomic)

SR = S.SR
BPM = 140
BEAT = 60 / BPM
BAR = 4 * BEAT
STEP = BAR / 16
SWING = 0.12 * STEP
SECTIONS = [("Intro", 4), ("Verse 1", 8), ("Build", 2), ("Chorus", 8), ("Hook", 4), ("Verse 2", 8),
            ("Breakdown", 4), ("Build", 2), ("Chorus", 8), ("Outro", 5)]
RULES = [("kick", 1), ("hat", 3), ("snare", 6), ("clap", 10)]
LEVEL = {"Intro": 0.45, "Verse 1": 0.72, "Verse 2": 0.72, "Build": 0.8, "Chorus": 1.0, "Hook": 0.95,
         "Breakdown": 0.32, "Outro": 0.42}

CH = {"Am7": [57, 60, 64, 67], "Fmaj7": [53, 57, 60, 64], "C": [48, 55, 60, 64], "G": [55, 59, 62, 67],
      "Em7": [52, 55, 59, 62], "Dm7": [50, 53, 57, 60]}
PROG = {"verse": ["Am7", "Fmaj7", "C", "G"], "chorus": ["Fmaj7", "G", "Em7", "Am7"], "build": ["Fmaj7", "G"]}
SCALE = [57, 59, 60, 62, 64, 65, 67]  # A natural minor from A3

# the hook: one contour per sung line (MIDI notes, A minor); syllables are spread across each contour
# the hook: one contour per sung line (MIDI, A minor), sitting low so the voice moves at most a few semitones
# from where it speaks. Nuclei (syllables) are spread across each contour.
HOOK = [[57, 60, 62, 60, 57, 60, 62, 62],          # over F - G, ends on D
        [59, 57, 55, 57, 59, 60, 59, 57, 55, 57],  # over Em - Am, home on A
        [57, 60, 62, 64, 62, 60, 62, 64, 62],      # lifts to E, ends on D
        [64, 62, 60, 62, 60, 59, 57, 55, 57]]      # falls home
BREAK = [60, 60, 59, 57, 59, 57, 55, 57, 55]


def chord_at(sec, i):
    key = "chorus" if sec in ("Chorus", "Hook") else "build" if sec == "Build" else "verse"
    p = PROG[key]
    return CH[p[i % len(p)]]


def bar_sections():
    out = []
    for name, n in SECTIONS:
        out += [(name, k, n) for k in range(n)]
    return out


# ---------- data ----------

def weeks_from_calendar(cal):
    days = sorted(cal)
    n = len(days) // 7 * 7
    days = days[-n:]
    return [[(d, cal[d]) for d in days[i:i + 7]] for i in range(0, n, 7)]


def stats(cal):
    from year_card import stats as year_stats
    return year_stats(cal)


def repo_facts():
    try:
        repos = gh_api(f"/users/{USER}/repos?sort=pushed&per_page=100&type=owner")
    except Exception as e:
        print(f"repo list unavailable ({e}); lyrics will skip repo names")
        return None
    own = [r for r in repos if not r["fork"] and not r["archived"] and r["name"] != USER]
    langs = {}
    for r in own:
        if r["language"]:
            langs[r["language"]] = langs.get(r["language"], 0) + 1
    top_langs = sorted(langs, key=lambda k: -langs[k])
    return dict(recent=[r["name"] for r in own[:3]], n_own=len(own), langs=top_langs[:2])



# ---------- instrumental ----------

def sw(step):
    """Swung time offset for a 16th step."""
    return step * STEP + (SWING if step % 2 else 0)


def instrumental(weeks, rng):
    """Returns stems dict (each stereo [2, n]) and kick times for sidechain."""
    nb = len(weeks)
    n = int(SR * (nb * BAR + 4))
    st = {k: np.zeros((2, n)) for k in ("drums", "bass", "keys", "pad", "chords", "pluck", "lead", "fx")}
    kicks = []
    maxw = max(1, max(sum(c for _, c in w) for w in weeks if w) if any(weeks) else 1)
    bars = bar_sections()
    lead_n, lead_t, lead_d = [], [], []
    bass_n, bass_t, bass_d = [], [], []
    for b, (sec, k, secn) in enumerate(bars):
        t0 = b * BAR
        wk = weeks[b] if b < len(weeks) else []
        w = sum(c for _, c in wk) / maxw
        ch = chord_at(sec, k)
        root = ch[0] - 24
        while root < 31:
            root += 12
        hv = lambda: float(rng.uniform(0.85, 1.05))
        lvl = LEVEL[sec]
        drums = st["drums"]
        full = sec in ("Chorus", "Hook")
        verse = sec.startswith("Verse")
        nbar = int(BAR * SR) + int(SR * 0.6)

        # --- drums ---
        if verse or full:
            kpat = [0, 10] if verse else [0, 7, 10]
            if w > 0.4:
                kpat += [3] if verse else [14]
            for s in kpat:
                v = (1.0 if s == 0 else 0.85) * hv()
                S.add(drums, S.pan(S.kick(v), 0) * lvl, t0 + s * STEP)
                kicks.append(t0 + s * STEP)
            S.add(drums, S.pan(S.snare(0.9 * hv()), 0.05) * lvl, t0 + 8 * STEP)
            if full:
                S.add(drums, S.pan(S.clap(0.8 * hv()), -0.1) * lvl, t0 + 8 * STEP + 0.008)
            # hats: 8ths when quiet, 16ths when busy, a 32nd roll on busy weeks at the end of the bar
            hs = range(0, 16, 2) if w < 0.25 else range(16)
            for s in hs:
                v = (0.55 if s % 4 == 0 else 0.4 if s % 2 == 0 else 0.28) * hv()
                S.add(drums, S.pan(S.hat(v), 0.3) * lvl, t0 + sw(s))
            if w > 0.6 or (k == secn - 1 and full):
                for r in range(6):
                    S.add(drums, S.pan(S.hat(0.25 + 0.04 * r), 0.3) * lvl, t0 + 13 * STEP + r * STEP / 2)
            if k == secn - 1 and verse:  # fill into the next section
                for r, s in enumerate((12, 13, 14, 15)):
                    S.add(drums, S.pan(S.snare(0.35 + 0.12 * r), 0.05) * lvl, t0 + s * STEP)
        elif sec == "Build":
            # quarter kicks, snare roll speeding up from 8ths to 32nds over the 2 bars
            for s in range(0, 16, 4):
                S.add(drums, S.pan(S.kick(0.8), 0) * lvl, t0 + s * STEP)
            div = 2 if k == 0 else 4
            cnt = 8 * div // 2 if k == 0 else 28  # the last 1/8 is left empty before the drop
            for r in range(cnt):
                tt = t0 + r * BAR / (8 * div // 2 if k == 0 else 32)
                S.add(drums, S.pan(S.snare(0.25 + 0.6 * (k * cnt + r) / (2 * cnt)), 0.05) * lvl, tt)
        elif sec in ("Intro", "Outro"):
            if (sec == "Intro" and k >= 2) or (sec == "Outro" and k < 2):
                for s in range(0, 16, 2):
                    S.add(drums, S.pan(S.hat(0.3 * hv()), 0.3) * lvl, t0 + sw(s))
                S.add(drums, S.pan(S.rim(0.5), -0.2) * lvl, t0 + 8 * STEP)
        # daily rule layer (quiet): each day of the week = 2 steps
        if sec != "Breakdown":
            for d, (_, c) in enumerate(wk):
                v = min(1.0, 0.25 + c / 20)
                tt = t0 + sw(2 * d + 1)
                if c >= 1:
                    S.add(drums, S.pan(S.kick(0.35 * v), 0) * lvl, tt)
                if c >= 3:
                    S.add(drums, S.pan(S.hat(0.5 * v, open_=True), -0.35) * lvl, tt)
                if c >= 6:
                    S.add(drums, S.pan(S.rim(0.5 * v), 0.25) * lvl, tt)
                if c >= 10:
                    S.add(drums, S.pan(S.clap(0.45 * v), 0.1) * lvl, tt)

        # --- 808 ---
        if verse or full or (sec == "Build" and k == 0):
            pat = [(0, 6)] if w < 0.35 else [(0, 5), (6, 4)] if w < 0.7 else [(0, 5), (6, 3), (10, 2), (14, 2)]
            for s, d in pat:
                note = root + (12 if (s == 14 and w >= 0.7) else 0)
                if s == 10 and w >= 0.7:
                    note = root + 7
                bass_n.append(note)
                bass_t.append(t0 + s * STEP)
                bass_d.append(d * STEP)

        # --- pad, keys, chords ---
        cut = 700 + 2600 * w
        if sec in ("Intro", "Breakdown", "Outro") or verse:
            pad = S.warm_pad([x - 12 for x in ch[:3]] + [ch[3]], nbar, cutoff=cut if verse else 900 + 300 * k)
            S.add(st["pad"], pad * 0.5 * lvl, t0)
            # e-piano comp: chord on 1, more stabs on busier weeks
            hits = [0] if w < 0.15 and verse else [0, 6] if w < 0.5 else [0, 6, 10, 14]
            for h in hits:
                for j, note in enumerate(ch):
                    x = S.epiano(note, int(SR * (BAR - h * STEP) * 0.9), 0.32 * hv())
                    S.add(st["keys"], S.pan(x, -0.25 + 0.15 * j) * lvl, t0 + sw(h) + 0.006 * j)
        if full or sec == "Build":
            open_ = 1.0 if full else 0.35 + 0.3 * k
            ss = S.supersaw(ch + [ch[0] + 12], nbar, cutoff=1000 + 2600 * open_ * (0.7 + 0.3 * w), rel=0.2)
            if full:  # future-bass style: chord re-struck on the swung 8ths so the sidechain pumps it
                for s in (0, 3, 6, 10, 12):
                    seg = ss[:, :int(STEP * 2.5 * SR)] * S.adsr(int(STEP * 2.5 * SR), 0.004, 0.1, 0.8, 0.04)
                    S.add(st["chords"], seg * 0.55 * lvl, t0 + s * STEP)
            else:
                S.add(st["chords"], ss * 0.35 * lvl, t0)
            if full:
                # pluck arp, 8ths on quiet weeks, 16ths on busy ones
                arp = [ch[0] + 12, ch[2] + 12, ch[1] + 12, ch[3] + 12]
                stp = 2 if w < 0.5 else 1
                for i, s in enumerate(range(0, 16, stp)):
                    x = S.pluck(arp[i % 4], int(SR * 0.3), 0.22 * hv(), bright=2500 + 3000 * w)
                    S.add(st["pluck"], S.pan(x, 0.4 if i % 2 else -0.4) * lvl, t0 + sw(s))

        # --- lead responses in the verses: a short answer in the gap after each 2-bar rap line ---
        if verse and k % 2 == 1:
            motif = [[69, 67, 64], [67, 64, 62], [64, 67, 69], [72, 71, 69]][(k // 2) % 4]
            cnt = 2 if w < 0.3 else 3
            for i, note in enumerate(motif[:cnt]):
                lead_n.append(note)
                lead_t.append(t0 + (12 + i * 1.5) * STEP)
                lead_d.append(1.3 * STEP if i < cnt - 1 else 2.5 * STEP)

        # --- fx ---
        if sec == "Build" and k == 0:
            S.add(st["fx"], S.pan(S.riser(2 * BAR - STEP * 2), 0) * 0.5, t0)
            S.add(st["fx"], S.pan(S.reverse_cymbal(1.2), 0) * 0.5, t0 + 2 * BAR - 1.2)
        if sec == "Intro" and k == 2:
            S.add(st["fx"], S.pan(S.riser(2 * BAR), 0) * 0.25, t0)
        if (full and k == 0) or (sec.startswith("Verse") and k == 0 and b > 4):
            S.add(st["fx"], S.pan(S.impact(2.0), 0) * (0.7 if full else 0.35), t0)
        if sec in ("Intro", "Breakdown", "Outro") or verse:
            S.add(st["fx"], np.stack([S.crackle(nbar - int(SR * 0.6)), S.crackle(nbar - int(SR * 0.6))]) * 0.05, t0)

    b808 = S.bass808(bass_n, bass_t, bass_d, n, glide=0.07, drive=2.2)
    st["bass"] = np.stack([b808, b808]) * 0.6
    st["lead"] = S.pan(S.lead(lead_n, n, lead_t, lead_d, vel=0.32), 0.15)
    return st, kicks, n


# ---------- vocals ----------

def place(buf, x, t):
    S.add(buf, x, t)


def melody(contour, t0, span, step=2):
    """Synth-lead notes for a contour: one note per `step` 16ths from t0, the last one held to the end of the
    span. Returns [(midi, start, dur)] an octave above the written contour."""
    out = []
    for k, m in enumerate(contour):
        a = t0 + k * step * STEP
        last = k == len(contour) - 1
        dur = (t0 + span * 0.95 - a) if last else step * STEP * 0.9
        out.append((m + 12, a, dur))
    return out


def edge_fade(y, ms=6):
    k = min(len(y) // 2, int(ms / 1000 * SR))
    y = y.copy()
    y[:k] *= np.linspace(0, 1, k)
    y[-k:] *= np.linspace(1, 0, k)
    return y


def vocals(lyrics, n):
    """Returns vocal stems (stereo), the instrumental lead that doubles the hook, notes for analysis, timeline."""
    rap_v = V.load(V.RAP_VOICE)
    sing_v = V.load(V.SING_VOICE)
    st = {k: np.zeros((2, n)) for k in ("rap", "sing", "throws")}
    hook_lead = np.zeros((2, n))
    lead_only = np.zeros(n)
    timeline = []
    starts, acc = {}, 0
    for name, nb in SECTIONS:
        starts.setdefault(name, []).append(acc * BAR)
        acc += nb

    def tl(t, end, sec, text):
        timeline.append(dict(start=t, end=end, section=sec, text=text))

    # intro / outro: spoken, a bit of radio filter on the intro tag
    t = starts["Intro"][0] + 0.5 * BAR
    d, sp, _ = lyrics["Intro"][0]
    x = V.tts(rap_v, sp, 1.0)
    x = signal.sosfilt(S.sos("bandpass", [250, 4500]), x)
    place(st["rap"], S.pan(edge_fade(x), 0) * 0.9, t)
    tl(t, t + len(x) / SR, "Intro", d)
    for i, (d, sp, _) in enumerate(lyrics["Outro"]):
        t = starts["Outro"][0] + (0.25 + 2 * i) * BAR
        x = V.tts(rap_v, sp, 0.95)
        place(st["rap"], S.pan(edge_fade(x), 0) * 0.9, t)
        tl(t, t + len(x) / SR, "Outro", d)

    # verses: one line per 2 bars, Piper's own speed control (length_scale) fits it to the bars
    for sec in ("Verse 1", "Verse 2"):
        for i, (d, sp, _) in enumerate(lyrics[sec]):
            t = starts[sec][0] + 2 * i * BAR
            x = V.rap_line(rap_v, sp, 2 * BAR * 0.86)
            x = S.compress(x / (np.max(np.abs(x)) + 1e-9), thr_db=-16, ratio=2.5, attack=0.01, release=0.12)
            place(st["rap"], S.pan(edge_fade(x), 0) * 0.85, t)
            tl(t, t + len(x) / SR, sec, d)

    # chorus: the second voice chants each line on the downbeat, natural pitch and timing (no retune).
    # The synth lead plays the hook melody under it. Rendered once and placed at both choruses.
    clen = int(8 * BAR * SR) + SR * 2
    lead_v = np.zeros(clen)
    ctl, mel = [], []
    for i, (d, sp, _) in enumerate(lyrics["Chorus"]):
        t = 2 * i * BAR
        x = V.rap_line(sing_v, sp, 2 * BAR * 0.8)
        x = S.compress(x / (np.max(np.abs(x)) + 1e-9), thr_db=-16, ratio=2.5, attack=0.01, release=0.12)
        S.add(lead_v, edge_fade(x), t)
        ctl.append((t, t + len(x) / SR, d))
        mel += melody(HOOK[i], t, 2 * BAR)
    lead_line = S.lead([m for m, _, _ in mel], clen, [a for _, a, _ in mel], [b for _, _, b in mel], vel=0.13, vibrato=0.25)
    for c0 in starts["Chorus"]:
        place(st["sing"], S.pan(lead_v, 0), c0)
        S.add(lead_only, lead_v, c0)
        place(hook_lead, S.pan(lead_line, -0.1), c0)
        for (a, e, d) in ctl:
            tl(c0 + a, c0 + e, "Chorus", d)
            # delay throw on the last word of each line
            m = int((e - 0.45) * SR)
            thr = np.zeros(clen)
            thr[m:int(e * SR)] = lead_v[m:int(e * SR)] * np.linspace(0, 1, int(e * SR) - m) ** 0.5
            place(st["throws"], S.pan(thr, 0), c0)

    # hook: instrumental, the synth lead plays the first two chorus lines' melody
    h0 = starts["Hook"][0]
    motif = melody(HOOK[0], 0, 2 * BAR) + melody(HOOK[1], 2 * BAR, 2 * BAR)
    place(hook_lead, S.pan(S.lead([m for m, _, _ in motif], int(4.2 * BAR * SR), [a for _, a, _ in motif],
                                  [b for _, _, b in motif], vel=0.3, vibrato=0.3), 0.1), h0)

    # breakdown: one line, spoken softly over the keys, lead plays the breakdown melody
    b0 = starts["Breakdown"][0]
    d, sp, _ = lyrics["Breakdown"][0]
    x = V.rap_line(sing_v, sp, 2.2 * BAR)
    x = edge_fade(x / (np.max(np.abs(x)) + 1e-9))
    place(st["sing"], S.pan(x * 0.8, 0), b0 + 0.25 * BAR)
    S.add(lead_only, x, b0 + 0.25 * BAR)
    tl(b0 + 0.25 * BAR, b0 + 0.25 * BAR + len(x) / SR, "Breakdown", d)
    bm = melody(BREAK, 0, 3.6 * BAR, step=4)
    place(hook_lead, S.pan(S.lead([m for m, _, _ in bm], int(4.5 * BAR * SR), [a for _, a, _ in bm],
                                  [b for _, _, b in bm], vel=0.1, vibrato=0.4), 0.2), b0 + 0.25 * BAR)

    # outro: lead plays the first chorus line once more, quietly
    o0 = starts["Outro"][0]
    first = melody(HOOK[0], 0, 2 * BAR)
    place(hook_lead, S.pan(S.lead([m for m, _, _ in first], int(2.5 * BAR * SR), [a for _, a, _ in first],
                                  [b for _, _, b in first], vel=0.14), 0), o0 + 3 * BAR)

    timeline.sort(key=lambda l: l["start"])
    st["lead_only"] = lead_only
    return st, hook_lead, timeline


# ---------- mix / master ----------

def mixdown(inst, kicks, vox, hook_lead, n, length):
    pump = S.sidechain(n, kicks, depth=0.55, release=0.16)
    pump_soft = S.sidechain(n, kicks, depth=0.3, release=0.12)
    # only pump in the chorus/hook bars
    mask = np.zeros(n)
    acc = 0
    for name, nb in SECTIONS:
        if name in ("Chorus", "Hook"):
            mask[int(acc * BAR * SR):int((acc + nb) * BAR * SR)] = 1
        acc += nb
    k = int(0.02 * SR)
    mask = np.convolve(mask, np.ones(k) / k, mode="same")
    p = 1 - mask * (1 - pump)
    ps = 1 - mask * (1 - pump_soft)

    drums = S.compress(inst["drums"], thr_db=-14, ratio=3, attack=0.002, release=0.06) * 0.9
    bass = inst["bass"] * ps
    music = (inst["keys"] * 0.9 + inst["pad"] * 0.8 + inst["chords"] * p * 0.65 + inst["pluck"] * p * 0.6
             + inst["lead"] * 0.9 + hook_lead * 0.9)
    music = signal.sosfilt(S.sos("highpass", 120), music, axis=1)
    fx = inst["fx"]

    # vocals: EQ, gentle compression, de-ess, short room, delay throws. No pitch or time processing.
    def norm(x, peak):
        return x / (np.max(np.abs(x)) + 1e-9) * peak

    def clean(x, hp):
        x = signal.sosfilt(S.sos("highpass", hp), x, axis=1)
        x = S.compress(x, thr_db=-20, ratio=2.5, attack=0.01, release=0.15)
        x = x + 0.4 * signal.sosfilt(S.sos("bandpass", [2000, 5000]), x, axis=1)  # a little presence
        return np.stack([V.deess(c) for c in x])

    rap = norm(clean(vox["rap"], 100), 0.55)
    sing = clean(vox["sing"], 90)
    sing_peak = np.max(np.abs(sing)) + 1e-9
    sing = sing / sing_peak * 0.62
    throws = S.delay(vox["throws"] / sing_peak * 0.5, BEAT * 0.75, feedback=0.4, repeats=4)
    vocal_bus = rap + sing
    verb = S.reverb(vocal_bus, seconds=0.9, decay=0.22) * 0.12  # short room
    slap = S.delay(rap, BEAT / 2, feedback=0.25, repeats=2) * 0.25
    mverb = S.reverb(music * 0.5 + fx * 0.3, seconds=2.0, decay=0.5) * 0.25

    # duck music a little under the vocal
    venv = np.convolve(np.abs(vocal_bus).max(0), np.ones(int(0.05 * SR)) / int(0.05 * SR), mode="same")
    duck = 1 - 0.45 * np.clip(venv / (np.max(venv) + 1e-9) * 4, 0, 1)

    # carve 1-4 kHz out of the music while words are sung or rapped (about -7 dB at full vocal level)
    mid = signal.sosfiltfilt(S.sos("bandpass", [1000, 4000]), music, axis=1)
    carve = 0.55 * np.clip(venv / (np.max(venv) + 1e-9) * 4, 0, 1)
    music = music - mid * carve
    mbus = norm(music, 1.0) * 0.38 * duck + mverb * 0.3
    out = (drums / (np.max(np.abs(drums)) + 1e-9) * 0.55 + norm(bass, 1.0) * 0.42 + mbus + fx * 0.35
           + vocal_bus + verb + throws * 0.6 + slap)
    out = out[:, :int(SR * length)]
    fade = int(SR * 2.0)
    out[:, -fade:] *= np.linspace(1, 0, fade) ** 1.5
    vox_solo = (vocal_bus + verb + throws * 0.6 + slap)[:, :int(SR * length)]
    return out, vox_solo


def master(x, target=-13.6, ceiling=-1.5):
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    # gentle glue compression (slow, low ratio) so the quiet sections stay quiet
    x = S.compress(x / (np.max(np.abs(x)) + 1e-9) * 0.5, thr_db=-16, ratio=1.6, attack=0.02, release=0.25)
    for _ in range(4):
        lu = meter.integrated_loudness(x.T)
        x = x * 10 ** ((target - lu) / 20)
        x = S.limit(x, ceiling_db=ceiling)
    return x, meter.integrated_loudness(x.T)


# ---------- output ----------

def write_wav(path, stereo):
    import wave
    x = np.clip(stereo, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[0])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x.T * 32767).astype(np.int16).tobytes())


def encode_mp3(stereo, path):
    with tempfile.TemporaryDirectory() as d:
        wav, mp3 = os.path.join(d, "s.wav"), os.path.join(d, "s.mp3")
        write_wav(wav, stereo)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-ar", str(SR), "-codec:a", "libmp3lame", "-b:a", "160k", "-map_metadata", "-1",
                        "-fflags", "+bitexact", "-flags:a", "+bitexact", mp3], check=True)
        with open(mp3, "rb") as f:
            write_atomic(path, f.read())


def mmss(sec):
    return f"{int(sec // 60)}:{int(sec % 60):02d}"


def lyrics_md(timeline, s, length):
    out = [f"# Contribution song", "",
           f"{mmss(length)} · {BPM} BPM · A minor · {s['total']} contributions from "
           f"{s['first']:%b %-d, %Y} to {s['last']:%b %-d, %Y}", "",
           "Every bar is one week of my GitHub contribution calendar, in order. Busier weeks get more hats, kicks, "
           "808 notes and keys, and every day still triggers its own drum hit. The verses are rapped, the chorus is "
           "sung on the hook melody, and the lyrics are filled in from the same numbers. A GitHub Action rebuilds it "
           "every night.", ""]
    cur = None
    for line in timeline:
        if line["section"] != cur:
            cur = line["section"]
            out += ["", f"## {cur}", ""]
        out.append(f"`{mmss(line['start'])}` {line['text']}  ")
    out += ["", "[Play it in the browser](https://nishal21.github.io/nishal21/player/) or "
            "[download the MP3](https://nishal21.github.io/nishal21/player/contribution-song.mp3).", ""]
    return "\n".join(out).replace("\n\n\n", "\n\n")


def lrc(timeline, s):
    out = [f"[ti:Contribution song]", f"[ar:Nishal K]", f"[al:{s['total']} contributions]"]
    for l in timeline:
        m, sec = divmod(l["start"], 60)
        out.append(f"[{int(m):02d}:{sec:05.2f}]{l['text']}")
    return "\n".join(out) + "\n"


def song_json(s, facts, weeks, timeline, length, song):
    """Everything the player page needs: timing, lyrics, stats, the weekly grid and a waveform."""
    acc, sections = 0, []
    for name, nb in SECTIONS:
        sections.append(dict(name=name, start=round(acc * BAR, 3), bars=nb))
        acc += nb
    data = dict(
        title="Contribution song", artist="Nishal K", length=round(length, 3), bpm=BPM, key="A minor",
        bar=round(BAR, 6), generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        rules=[dict(name=n, min=m) for n, m in RULES], sections=sections,
        stats=dict(total=s["total"], active=s["active"], days=s["n"], first=str(s["first"]), last=str(s["last"]),
                   best=str(s["best"]), best_n=s["best_n"], month=f"{s['month'][0]}-{s['month'][1]:02d}",
                   month_n=s["month_n"], streak=s["longest"], streak_start=str(s["lstart"]), streak_end=str(s["lend"]),
                   recent=(facts or {}).get("recent", []), langs=(facts or {}).get("langs", [])),
        weeks=[dict(start=str(w[0][0]) if w else None, days=[c for _, c in w]) for w in weeks],
        lines=[dict(t=round(l["start"], 3), end=round(l["end"], 3), section=l["section"], text=l["text"])
               for l in timeline],
        peaks=[round(float(p), 3) for p in peaks(song, 400)])
    return json.dumps(data, separators=(",", ":"))


def peaks(stereo, n):
    mono = np.abs(stereo).mean(0)
    chunks = np.array_split(mono, n)
    p = np.array([np.sqrt(np.mean(c ** 2)) for c in chunks])
    return p / (p.max() + 1e-9)


SEC_COLORS = {"Intro": "muted", "Verse 1": "text", "Build": "muted", "Chorus": "icon", "Hook": "icon",
              "Verse 2": "text", "Breakdown": "muted", "Outro": "muted"}
SEC_SHORT = {"Intro": "In", "Verse 1": "V1", "Build": "", "Chorus": "Chorus", "Hook": "Hook", "Verse 2": "V2",
             "Breakdown": "Break", "Outro": "Out"}


def render_card(s, length, wave_peaks, t):
    w, h = CARD_W, CARD_H
    label = f"Contribution song · {mmss(length)} · {s['total']} contributions"
    out = [card_open(t, label=label)]
    out.append(f'<text x="25" y="35" font-family="{FONT}" font-size="18" font-weight="600" fill="{t["title"]}">Contribution song</text>')
    out.append(f'<text x="{w-25}" y="34" text-anchor="end" font-family="{FONT}" font-size="11" fill="{t["muted"]}">{BPM} BPM · A minor · 1 bar = 1 week</text>')
    x0, x1, mid, amp = 25, w - 25, 92, 34
    n = len(wave_peaks)
    bw = (x1 - x0) / n
    edges, acc = [], 0
    for name, nb in SECTIONS:
        edges.append((name, acc * BAR / length, (acc + nb) * BAR / length))
        acc += nb
    def color_at(frac):
        for name, a, b in edges:
            if a <= frac < b:
                return t[SEC_COLORS[name]]
        return t["muted"]
    for i, p in enumerate(wave_peaks):
        hh = max(1.5, amp * p)
        out.append(f'<rect x="{x0 + i*bw:.1f}" y="{mid - hh:.1f}" width="{max(1, bw - 1.2):.1f}" height="{2*hh:.1f}" rx="1" fill="{color_at((i + 0.5) / n)}" fill-opacity="{0.45 + 0.55*p:.2f}"/>')
    # section strip
    for name, a, b in edges:
        xa, xb = x0 + a * (x1 - x0), x0 + min(b, 1) * (x1 - x0)
        out.append(f'<rect x="{xa:.1f}" y="136" width="{xb - xa - 2:.1f}" height="3" rx="1.5" fill="{t[SEC_COLORS[name]]}" fill-opacity="0.8"/>')
        short = SEC_SHORT.get(name, name)
        if not short or len(short) * 6 > xb - xa:
            continue
        out.append(f'<text x="{(xa + xb) / 2:.1f}" y="152" text-anchor="middle" font-family="{FONT}" font-size="10" fill="{t["muted"]}">{esc(short)}</text>')
    out.append(f'<text x="25" y="{h-18}" font-family="{FONT}" font-size="11.5" fill="{t["text"]}"><tspan font-weight="700">{mmss(length)}</tspan> · {s["total"]} contributions · {len(SECTIONS)} sections</text>')
    out.append(f'<text x="{w-25}" y="{h-18}" text-anchor="end" font-family="{FONT}" font-size="10" fill="{t["muted"]}">vocals: Piper TTS, two voices</text>')
    out.append("</svg>\n")
    return "\n".join(out)



def main():
    if not shutil.which("ffmpeg"):
        fail("ffmpeg not found")
    stems_dir = os.environ.get("SONG_STEMS")  # optional: write stems + note list for analysis
    try:
        cal = contribution_calendar()
        s = stats(cal)
        weeks = weeks_from_calendar(cal)
        target = sum(n for _, n in SECTIONS)
        if len(weeks) != target:
            # the arrangement expects 53 bars; pad or trim the oldest weeks if GitHub returns a different span
            weeks = ([[]] * max(0, target - len(weeks)) + weeks)[-target:]
        facts = repo_facts()
        lyrics = LY.build_lyrics(s, facts, USER)
        rng = np.random.default_rng(s["total"])
        inst, kicks, n = instrumental(weeks, rng)
        vox, hook_lead, timeline = vocals(lyrics, n)
        length = len(weeks) * BAR + 2.0
        song, vox_solo = mixdown(inst, kicks, vox, hook_lead, n, length)
        song, lufs = master(song)
    except Exception as e:
        import traceback
        traceback.print_exc()
        fail(f"song failed: {e}")
    if stems_dir:
        os.makedirs(stems_dir, exist_ok=True)
        write_wav(os.path.join(stems_dir, "sing.wav"), vox["lead_only"][None] / (np.max(np.abs(vox["lead_only"])) + 1e-9) * 0.9)
        write_wav(os.path.join(stems_dir, "mix.wav"), song)
        for k in ("rap", "sing"):
            write_wav(os.path.join(stems_dir, f"stem-{k}.wav"), vox[k] / (np.max(np.abs(vox[k])) + 1e-9) * 0.9)
        write_wav(os.path.join(stems_dir, "vocals.wav"), vox_solo / (np.max(np.abs(vox_solo)) + 1e-9) * 0.89)
        with open(os.path.join(stems_dir, "notes.json"), "w") as f:
            json.dump(dict(timeline=timeline), f)
    encode_mp3(song, os.path.join(ASSETS, "contribution-song.mp3"))
    write_atomic(os.path.join(ASSETS, "contribution-song-lyrics.md"), lyrics_md(timeline, s, length))
    wp = peaks(song, 96)
    for name, t in THEMES.items():
        write_atomic(os.path.join(ASSETS, f"song-{name}.svg"), render_card(s, length, wp, t))
    write_atomic(os.path.join(ASSETS, "contribution-song.lrc"), lrc(timeline, s))
    write_atomic(os.path.join(ASSETS, "contribution-song.json"), song_json(s, facts, weeks, timeline, length, song))
    print(f"song: {mmss(length)} ({length:.1f}s), {len(weeks)} bars, {len(timeline)} vocal lines, {lufs:.1f} LUFS")


if __name__ == "__main__":
    main()
