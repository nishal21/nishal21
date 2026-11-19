"""New Runware takes of the contribution song, made by the nightly job when the lyrics change.

The six voice slots (assets/song-voices.json: Original and Acoustic, each male, female and duet) started as takes I
made by hand and pinned with scripts/pin_song.py. This keeps them current: when tonight's lyrics (the numbers in them)
differ from the ones a slot's take sings, today's two slots in the 3-day rotation are sung again on Runware, with the
same models, prompts and seeds as the hand-picked takes:
  Original male    MiniMax Music 2.6    Original female  MiniMax Music 2.6    Original duet  MiniMax Music 2.6
  Acoustic male    ACE-Step v1.5 XL     Acoustic female  ACE-Step v1.5 XL     Acoustic duet  MiniMax Music 2.6
One try per slot, no retries, and the run stops before it would spend more than RUNWARE_CAP (default $1; today's
slots cost $0.17 to $0.30). A take only goes live when it passes the check: a sane length and loudness, Whisper hears
every line but one (the outro included), and it hears tonight's contribution total. Otherwise the last good take
stays, and the same lyrics aren't tried again (no credit spent on them twice). Kokoro only sings when a style has no
take at all, which contribution_song.py already handles.

Takes live on the rolling "contribution-song-runware" release, not in git (the repo would grow every night):
rw-<style>-<voice>.{mp3,json,lrc} plus runware-log.json (every try: lyrics hash, cost, result). The committed slot
files stay the hand-pinned ones; every run lays the release's takes over them before the song is built.

  runware_song.py apply             put the release's takes in place (no key, nothing spent)
  runware_song.py plan              today's slots and whether each needs a new take (no key, nothing spent)
  runware_song.py sing OUT_DIR      sing today's slots that need it; files to upload go to OUT_DIR
  runware_song.py park DIR|unpark DIR   set the slot files aside so the commit keeps the hand-pinned ones
  runware_song.py balance           the Runware account balance
Env: TAKE_LINES (tonight's lines, from contribution_song.py), RUNWARE_API_KEY, RUNWARE_CAP, RUNWARE_FORCE=1 (sing
today's slots even if their lyrics were tried), RUNWARE_SLOTS="original:male,acoustic:female" (instead of today's).
Never prints the key.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ASSETS, USER, write_atomic  # noqa: E402

API = "https://api.runware.ai/v1"
RELEASE = "contribution-song-runware"
RELEASE_URL = f"https://github.com/{USER}/{USER}/releases/download/{RELEASE}/"
LOG = "runware-log.json"
VERSION = 1  # bump to sing every slot again after changing a prompt or the lyric layout
MM, ACE = "minimax:music@2.6", "runware:ace-step@v1.5-xl-sft"
COST = {MM: 0.15, ACE: 0.03}  # what a take costs (MiniMax: $0.15 a song; ACE-Step 180 s at 50 steps: $0.022)
ENGINE = {MM: "Runware · MiniMax Music 2.6", ACE: "Runware · ACE-Step v1.5 XL"}
CAP = float(os.environ.get("RUNWARE_CAP", "1.0"))
PINS, VOICES = os.path.join(ASSETS, "song-pins.json"), os.path.join(ASSETS, "song-voices.json")
MAIN = {"original": "contribution-song", "acoustic": "contribution-song-acoustic"}
IST = timezone(timedelta(hours=5, minutes=30))
AUDIO = {"bitrate": 192, "channels": 2, "sampleRate": 44100}

# the prompts of the takes I picked (Nov 18, 2026), word for word
PROMPT = {
    ("original", "male"): (
        "human hip-hop vocal, slightly raspy male voice, laid-back confident flow with swing, spontaneous breaths and "
        "mouth noise, warm analog mix, boom-bap/trap beat 140 BPM A minor. Sung chorus with real human pitch variation. "
        "No autotune, no robotic or synthetic voice, no vocoder. Perform the supplied lyrics clearly and exactly, word "
        "for word. No extra verses, no rewritten lines. Duration about 1:33, clean ending after the outro."),
    ("original", "female"): (
        "human female rapper, confident, natural breaths, swing, warm analog mix, boom-bap/trap 140 BPM A minor, sung "
        "hook with real pitch variation, no autotune, not robotic, follow lyrics exactly, word for word, clean ending "
        "after the outro. Verses rapped by a human female voice, chorus sung. About 1 minute and 33 seconds long. No "
        "extra verses, no rewritten lines."),
    ("original", "duet"): (
        "male and female rap duet, they trade verses, male on verse 1, female on verse 2, both on chorus, boom-bap/trap "
        "140 BPM A minor, human, not robotic. Natural breaths, warm analog mix, no autotune. Two clearly different "
        "voices. Follow the provided lyrics exactly, word for word, including the full outro. Clean ending after the "
        "outro. No extra verses, no rewritten lines."),
    ("acoustic", "male"): (
        "ballad, acoustic, singer-songwriter, fingerpicked acoustic guitar, soft piano, 72 BPM, C major, fully sung "
        "melodic male vocal, long held notes, legato phrasing, intimate, warm, breathy, unplugged coffeehouse ballad, "
        "no rap, no spoken word, no rhythmic chanting. Follow the lyrics exactly, word for word, include the outro."),
    ("acoustic", "female"): (
        "ballad, acoustic, singer-songwriter, fingerpicked acoustic guitar, soft piano, 72 BPM, C major, fully sung "
        "melodic female vocal, long held notes, legato phrasing, intimate, warm, breathy, unplugged coffeehouse ballad, "
        "no rap, no spoken word, no rhythmic chanting. Follow the lyrics exactly, word for word, include the outro."),
    ("acoustic", "duet"): (
        "slow acoustic ballad, 72 BPM, C major, fingerpicked acoustic guitar and soft piano, intimate singer-songwriter "
        "duet, fully SUNG melodic vocals with long held notes and legato phrasing, NO rap, NO spoken word, NO rhythmic "
        "chanting, gentle, warm, breathy, like an unplugged coffeehouse ballad. Male and female singers alternating sung "
        "lines in the verses, harmonies on the chorus, both voices clearly present. Follow the provided lyrics exactly, "
        "word for word, including the full outro. Clean ending after the outro. No extra verses, no rewritten lines."),
}
SEED = {("original", "male"): 211093, ("original", "female"): 410583, ("original", "duet"): 550583,
        ("acoustic", "male"): 540583, ("acoustic", "female"): 540217, ("acoustic", "duet"): 560583}
MODEL = {k: (ACE if k[0] == "acoustic" and k[1] != "duet" else MM) for k in SEED}
ACE_NEGATIVE = ("rap, rapping, hip hop, trap, spoken word, rhythmic chanting, fast delivery, aggressive, autotune, "
                "robotic vocals, vocoder")
TAG = {"Intro": "Intro", "Verse 1": "Verse", "Verse 2": "Verse", "Chorus": "Chorus", "Breakdown": "Bridge", "Outro": "Outro"}
DUET_TAG = {"Intro": "Intro - Male", "Verse 1": "Verse 1 - Male", "Verse 2": "Verse 2 - Female", "Chorus": "Chorus - Both",
            "Breakdown": "Bridge - Both", "Outro": "Outro - Both"}


def log(msg):
    print(msg, flush=True)


# ---------- lyrics ----------

def tonight():
    with open(os.environ.get("TAKE_LINES", "/tmp/contribution-lines.json")) as f:
        return json.load(f)["lines"]


JOINS = ("and", "with", "from", "in")  # where a long line splits, first choice first


def short_lines(text):
    """A long line as two short sung ones (the acoustic and duet takes): at its comma, else before a joining word."""
    if text.startswith("Nishal.") and ". " in text:  # the intro, a sentence a line
        return [p if p.endswith(".") else p + "." for p in text.rstrip(".").split(". ")]
    parts = [p.strip() for p in re.split(r"(?<=,)\s+", text)]
    out = []
    for p in parts:
        ws = p.split()
        cut = [i for i, w in enumerate(ws) if 2 < i < len(ws) - 1 and w in JOINS]
        if len(ws) > 6 and cut:
            i = min(cut, key=lambda i: (JOINS.index(ws[i]), abs(i - len(ws) / 2)))
            out += [" ".join(ws[:i]), " ".join(ws[i:])]
        else:
            out.append(p)
    return out


def model_lyrics(style, voice, lines):
    """The lyrics as each approved take got them: the male rap reads digits, the others numbers spelled out."""
    out, sec = [], None
    for ln in lines:
        if ln["section"] != sec:
            sec = ln["section"]
            tag = (DUET_TAG if voice == "duet" else TAG).get(sec, sec)
            if (style, voice) == ("original", "female"):
                tag = "Breakdown" if sec == "Breakdown" else tag
            out += ([""] if out and (style, voice) != ("original", "female") else []) + [f"[{tag}]"]
        if (style, voice) == ("original", "male"):
            out.append(ln.get("display") or ln["text"])
        elif (style, voice) == ("original", "female"):
            out.append(ln["text"])
        else:
            out += short_lines(ln["text"])
    return "\n".join(out).strip() + "\n"


def display_sheet(style, voice, lines):
    """[(section, text)] the lyric video shows, in the display spelling (digits), as pin_song.read_sheet gives it."""
    rows = []
    for ln in lines:
        t = ln.get("display") or ln["text"]
        if (style, voice) != ("original", "male"):
            t = t.replace("nishal21", "Nishal")
        rows.append((ln["section"], t))
    return rows


def task(style, voice, lines):
    k = (style, voice)
    t = {"taskType": "audioInference", "model": MODEL[k], "positivePrompt": PROMPT[k], "deliveryMethod": "async",
         "includeCost": True, "outputFormat": "MP3", "audioSettings": AUDIO, "seed": SEED[k]}
    if MODEL[k] == ACE:
        t.update(negativePrompt=ACE_NEGATIVE, duration=180, steps=50, CFGScale=10,
                 settings={"lyrics": model_lyrics(style, voice, lines), "bpm": 72, "keyScale": "C major",
                           "timeSignature": 4, "vocalLanguage": "en"})
    else:
        t["settings"] = {"instrumental": False, "lyrics": model_lyrics(style, voice, lines), "lyricsOptimizer": False}
    return t


def take_hash(t):
    return hashlib.sha256(json.dumps(dict(v=VERSION, task=t), sort_keys=True).encode()).hexdigest()[:16]


def today_slots():
    if os.environ.get("RUNWARE_SLOTS"):
        return [tuple(s.split(":")) for s in os.environ["RUNWARE_SLOTS"].split(",") if ":" in s]
    v = json.load(open(VOICES))
    day = (datetime.now(IST).date() - date.fromisoformat(v.get("epoch", "2026-11-19"))).days % len(v["days"])
    return [(st, v["days"][day][st]) for st in ("original", "acoustic")]


# ---------- the release ----------

def fetch(name, dest=None):
    req = urllib.request.Request(RELEASE_URL + name, headers={"User-Agent": f"{USER}-contribution-song"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    if dest:
        with open(dest, "wb") as f:
            f.write(data)
    return data


def release_take(style, voice, d):
    """(mp3, info) of the slot's take on the release, downloaded into d, or None."""
    raw = fetch(f"rw-{style}-{voice}.json")
    if not raw:
        return None
    try:
        info = json.loads(raw)
    except ValueError:
        return None
    mp3 = os.path.join(d, f"rw-{style}-{voice}.mp3")
    if not info.get("data") or not info.get("passed") or not fetch(f"rw-{style}-{voice}.mp3", mp3) or os.path.getsize(mp3) < 100_000:
        return None
    return mp3, info


def base_of(style, voice):
    v = json.load(open(VOICES))
    return (v.get(style) or {}).get(voice)


def place(style, voice, mp3, data):
    """Put a timed take in its slot the way pin_song.py pins one, so the pages and contribution_song.py pick it up."""
    import pin_song
    base = base_of(style, voice)
    if not base:
        log(f"{style} {voice}: no slot in song-voices.json, skipped")
        return False
    data = dict(data, src=f"{base}.mp3")
    main_original = base == MAIN["original"]
    dest = os.path.join(ASSETS, "pinned") if main_original else ASSETS
    shutil.copyfile(mp3, os.path.join(dest, f"{base}.mp3"))
    write_atomic(os.path.join(dest, f"{base}.json"), json.dumps(data, separators=(",", ":")))
    write_atomic(os.path.join(ASSETS, f"{base}.lrc"), pin_song.lrc(data["lines"], data["title"]))
    if main_original:  # as pin_song does: lay it over the song json now; contribution_song.py does it again later
        shutil.copyfile(mp3, os.path.join(ASSETS, f"{base}.mp3"))
        sj = os.path.join(ASSETS, f"{base}.json")
        if os.path.exists(sj):
            write_atomic(sj, json.dumps(pin_song.merge_original(json.load(open(sj)), data), separators=(",", ":")))
    pins = json.load(open(PINS))
    entry = dict(bpm=data["bpm"], length=data["length"], lines=len(data["lines"]), pinned=data["generated"])
    if base == MAIN[style]:
        pins[style].update(entry, voice=voice, engine=data["engine"], unsung=len(data.get("unsung") or []),
                           sheet=f"release {RELEASE}: rw-{style}-{voice}.json")
    else:
        pins[style].setdefault("voices", {})[voice] = dict(entry, file=f"{base}.mp3", engine=data["engine"])
    write_atomic(PINS, json.dumps(pins, indent=1) + "\n")
    return True


def apply():
    with tempfile.TemporaryDirectory() as d:
        for style, voice in SEED:
            got = release_take(style, voice, d)
            if got and place(style, voice, got[0], got[1]["data"]):
                log(f"{style} {voice}: the Runware take from {got[1].get('made')} (lyrics {got[1]['hash']}) is in place")
            else:
                log(f"{style} {voice}: no newer take on the release, the pinned one stays")
    return 0


# ---------- Runware ----------

def key():
    k = os.environ.get("RUNWARE_API_KEY", "").strip()
    if not k:
        return None
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::add-mask::{k}", flush=True)  # it's a secret already; masked twice for good measure
    return k


def post(k, tasks, timeout=120):
    req = urllib.request.Request(API, data=json.dumps(tasks).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {k}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace").replace(k, "[key]")
        try:
            return json.loads(body)
        except ValueError:
            return {"errors": [{"message": f"HTTP {e.code}: {body[:300]}"}]}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return {"errors": [{"message": f"network: {str(e).replace(k, '[key]')[:300]}"}]}


def balance(k):
    for _ in range(2):
        r = post(k, [{"taskType": "accountManagement", "taskUUID": str(uuid.uuid4()), "operation": "getDetails"}])
        b = ((r.get("data") or [{}])[0] or {}).get("balance")
        if isinstance(b, (int, float)):
            return float(b)
        time.sleep(5)
    return None


def errmsg(e):
    return " ".join(str(e.get(x)) for x in ("code", "message") if e.get(x))[:300]


def run_tasks(k, jobs, wait=20 * 60):
    """Submit every job once (async) and poll until each has audio or an error. No retries."""
    ack = post(k, [j["task"] for j in jobs])
    by = {j["task"]["taskUUID"]: j for j in jobs}
    for e in ack.get("errors") or []:
        j = by.get(e.get("taskUUID"))
        for jj in ([j] if j else jobs):  # an error without a task id (auth, credit) fails the whole submit
            jj.setdefault("error", errmsg(e) or "submit failed")
    pending = {u for u, j in by.items() if "error" not in j}
    t0, delay = time.time(), 30
    while pending and time.time() - t0 < wait:
        time.sleep(delay)
        delay = 20
        r = post(k, [{"taskType": "getResponse", "taskUUID": u} for u in sorted(pending)], timeout=60)
        for e in r.get("errors") or []:
            u = e.get("taskUUID")
            if u in pending:
                by[u]["error"] = errmsg(e) or "error"
                pending.discard(u)
        for row in r.get("data") or []:
            u = row.get("taskUUID")
            if u in pending and row.get("audioURL"):
                by[u].update(url=row["audioURL"], cost=row.get("cost"), seed_returned=row.get("seed"))
                pending.discard(u)
            elif u in pending and row.get("status") == "error":
                by[u]["error"] = "the model returned an error"
                pending.discard(u)
        log(f"  waiting on {len(pending)} take(s), {time.time() - t0:.0f} s")
    for u in pending:
        by[u]["error"] = f"no audio after {wait // 60} min"


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": f"{USER}-contribution-song"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


# ---------- the check ----------

def loudness(mp3):
    """(seconds, integrated LUFS, true peak dBFS) from ffmpeg's ebur128 meter."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", mp3, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    err = p.stderr
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    secs = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3]) if dur else 0.0
    i = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", err)
    pk = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", err)
    f = lambda v: float(v) if v and v != "-inf" else -99.0  # noqa: E731
    return secs, f(i[-1] if i else None), f(pk[-1] if pk else None)


def total_heard(words, total):
    """Is the contribution total sung where the lyrics have it? Whisper writes 1,040 as "1040", "one thousand forty",
    or drops a zero ("133" for 1,033), so the number before each "contributions" passes when it ends the total's
    digits (two at least) or matches them with the zeros left out. A take singing an older total still fails."""
    import visitor_take as T
    want, nz = str(total), str(total).replace("0", "")
    spoken = T.say_number(total)
    ws = [w for w in words if w]
    for i, w in enumerate(ws):
        if not w.startswith("contribut"):
            continue
        before = ws[max(0, i - 6):i]
        if any("".join(before[-k:]) == "".join(spoken) for k in range(1, len(before) + 1)):  # "thirty three" too
            return True
        nums = [x for x in before if x.isdigit()]
        for c in nums[-2:] + ["".join(nums[-2:])]:
            if len(c) >= 2 and (want.endswith(c) or c.replace("0", "") == nz):
                return True
    return False


def heard_total(mp3, total):
    """Whisper with no lyric prompt (so it can't be steered toward the right number): (heard the total?, what it heard)."""
    import pin_song
    words = [w for w, _, _ in pin_song.transcribe(mp3, "")]
    return total_heard(words, total), " ".join(words)


def check(style, voice, mp3, lines, sheet):
    """(passed, reason, pin json) for a new take."""
    import pin_song
    secs, lufs, peak = loudness(mp3)
    lo, hi = (40, 200) if MODEL[(style, voice)] == MM else (60, 240)
    if not lo <= secs <= hi:
        return False, f"length {secs:.0f} s (want {lo}-{hi})", None
    if not -30 <= lufs <= -5 or peak < -20:
        return False, f"loudness {lufs:.1f} LUFS, peak {peak:.1f} dBFS", None
    base = base_of(style, voice)
    data, al = pin_song.timing(style, mp3, sheet, ENGINE[MODEL[(style, voice)]],
                               110.0 if style == "acoustic" else 140.0, "C major" if style == "acoustic" else "A minor",
                               voice, base)
    unsung = [t for (_, t), r in zip(sheet, al) if not r]
    if len(unsung) > 1 or not all(al[-2:]):
        return False, f"{len(unsung)} line(s) not heard: {unsung[:3]}", None
    m = next((m for ln in lines for m in [re.search(r"([\d,]+) contributions", ln.get("display") or "")] if m), None)
    total = int(m[1].replace(",", "")) if m else None
    if total:
        ok, heard = heard_total(mp3, total)
        if not ok:
            return False, f"didn't hear tonight's total ({total}); heard: {heard[:200]}", None
    data["lufs"] = round(lufs, 1)
    return True, f"{secs:.0f} s, {lufs:.1f} LUFS, {len(sheet) - len(unsung)}/{len(sheet)} lines heard", data


# ---------- sing ----------

def plan(lines):
    """[(style, voice, task, hash, state)] for today's slots; state: new | same | tried."""
    logd = json.loads(fetch(LOG) or b"{}")
    out = []
    force = os.environ.get("RUNWARE_FORCE") == "1"
    for style, voice in today_slots():
        t = task(style, voice, lines)
        h = take_hash(t)
        cur = json.loads(fetch(f"rw-{style}-{voice}.json") or b"{}")
        tried = {x.get("hash") for x in logd.get("tries", []) if x.get("slot") == f"{style}-{voice}"}
        state = "same" if cur.get("hash") == h and cur.get("passed") else "tried" if h in tried else "new"
        if force and state != "same":
            state = "new"
        out.append((style, voice, t, h, state))
    return out, logd


def sing(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    lines = tonight()
    todo, logd = plan(lines)
    for style, voice, _, h, state in todo:
        log(f"{style} {voice}: lyrics {h}: " + {"same": "the take on the release already sings them, reused",
                                                "tried": "tried before and it didn't pass, the last good take stays",
                                                "new": "new lyrics, singing on Runware"}[state])
    todo = [x for x in todo if x[4] == "new"]
    gh = os.environ.get("GITHUB_OUTPUT")
    outputs = {"changed": "false", "original_changed": "false"}
    if not todo:
        return finish(gh, outputs)
    k = key()
    if not k:
        log("::warning::RUNWARE_API_KEY isn't set, so the last good takes stay")
        return finish(gh, outputs)
    jobs, spend = [], 0.0
    for style, voice, t, h, _ in todo:
        c = COST[t["model"]]
        if spend + c > CAP:
            log(f"{style} {voice}: skipped, it would take this run past the ${CAP:.2f} cap")
            continue
        spend += c
        jobs.append(dict(style=style, voice=voice, hash=h, task=dict(t, taskUUID=str(uuid.uuid4()))))
    before = balance(k)
    log(f"Runware balance before: {'$%.4f' % before if before is not None else 'unknown'}; this run at most ${spend:.2f}")
    if before is not None and before < spend:
        log("::warning::Runware credit is too low for tonight's takes, so the last good takes stay")
        jobs = []
    if jobs:
        run_tasks(k, jobs)
    made = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tries = logd.setdefault("tries", [])
    for j in jobs:
        style, voice, slot = j["style"], j["voice"], f"{j['style']}-{j['voice']}"
        rec = dict(slot=slot, hash=j["hash"], made=made, model=j["task"]["model"], seed=j["task"]["seed"],
                   cost=j.get("cost"), run=os.environ.get("GITHUB_RUN_ID"))
        tries.append(rec)
        if "error" in j:
            rec.update(passed=False, reason=f"Runware: {j['error']}")
            log(f"::warning::{style} {voice}: {rec['reason']}; the last good take stays")
            continue
        mp3 = os.path.join(out_dir, f"rw-{slot}.mp3")
        try:
            download(j["url"], mp3)
            ok, why, data = check(style, voice, mp3, lines, display_sheet(style, voice, lines))
        except Exception as e:  # noqa: BLE001  a broken file or a check that crashed never goes live
            ok, why, data = False, f"check failed: {type(e).__name__}: {e}"[:300], None
        rec.update(passed=ok, reason=why)
        log(f"{style} {voice}: {'passed' if ok else 'failed'} ({why}), cost ${float(j.get('cost') or 0):.4f}")
        if not ok:
            log(f"::warning::{style} {voice}: the new take didn't pass ({why}); the last good take stays")
            os.remove(mp3)
            continue
        info = dict(hash=j["hash"], passed=True, made=made, model=j["task"]["model"], seed=j["task"]["seed"],
                    cost=j.get("cost"), check=why, lyrics=j["task"]["settings"]["lyrics"], data=data)
        write_atomic(os.path.join(out_dir, f"rw-{slot}.json"), json.dumps(info, indent=1))
        import pin_song
        write_atomic(os.path.join(out_dir, f"rw-{slot}.lrc"), pin_song.lrc(data["lines"], data["title"]))
        place(style, voice, mp3, data)
        outputs["changed"] = "true"
        if base_of(style, voice) == MAIN["original"]:
            outputs["original_changed"] = "true"
        log(f"::notice::{style} {voice}: a new Runware take is live ({why})")
    after = balance(k) if jobs else before
    spent = sum(float(j.get("cost") or 0) for j in jobs)
    logd["spent_total"] = round(float(logd.get("spent_total") or 0) + spent, 5)
    logd["balance"] = after
    logd["tries"] = tries[-200:]
    write_atomic(os.path.join(out_dir, LOG), json.dumps(logd, indent=1))
    log(f"Runware: spent ${spent:.4f} this run, balance {'$%.4f' % after if after is not None else 'unknown'}")
    return finish(gh, outputs)


def finish(gh, outputs):
    if gh:
        with open(gh, "a") as f:
            f.writelines(f"{k}={v}\n" for k, v in outputs.items())
    return 0


# ---------- park the slot files for the commit ----------

def slot_files():
    v = json.load(open(VOICES))
    out = {"assets/song-pins.json", "assets/song-voices.json", "assets/pinned/contribution-song.mp3",
           "assets/pinned/contribution-song.json"}
    for st in ("original", "acoustic"):
        for b in (v.get(st) or {}).values():
            if b and b != MAIN["original"]:
                out |= {f"assets/{b}.mp3", f"assets/{b}.json", f"assets/{b}.lrc"}
    return sorted(out)


def park(d):
    """Copy the slot files aside and put back the committed ones, so the nightly commit doesn't add new MP3s."""
    os.makedirs(d, exist_ok=True)
    root = os.path.dirname(ASSETS)
    for rel in slot_files():
        p = os.path.join(root, rel)
        if os.path.exists(p):
            os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True)
            shutil.copy2(p, os.path.join(d, rel))
        subprocess.run(["git", "-C", root, "checkout", "-q", "HEAD", "--", rel], capture_output=True)
    return 0


def unpark(d):
    root = os.path.dirname(ASSETS)
    for rel in slot_files():
        if os.path.exists(os.path.join(d, rel)):
            shutil.copy2(os.path.join(d, rel), os.path.join(root, rel))
    return 0


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ""
    if cmd == "apply":
        return apply()
    if cmd == "plan":
        todo, _ = plan(tonight())
        for style, voice, t, h, state in todo:
            log(f"{style} {voice}: {t['model']}, lyrics {h}, {state} (${COST[t['model']]:.2f} if sung)")
            if "-v" in a:
                log(t["settings"]["lyrics"])
        return finish(os.environ.get("GITHUB_OUTPUT"), {"needed": str(any(x[4] == "new" for x in todo)).lower()})
    if cmd == "sing" and len(a) > 1:
        return sing(a[1])
    if cmd in ("park", "unpark") and len(a) > 1:
        return (park if cmd == "park" else unpark)(a[1])
    if cmd == "balance":
        k = key()
        b = balance(k) if k else None
        log(f"Runware balance: {'$%.4f' % b if b is not None else 'unknown'}")
        return 0
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
