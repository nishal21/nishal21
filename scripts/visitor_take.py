"""Visitor song take: the visitor song sung by ACE-Step 1.5, a free, open-source song model.

The lyrics (base lines plus every visitor line) go to ACE-Step with a short arrangement brief, and the result is
checked and polished before it replaces the last good take:
  1. acemusic.ai, the ACE-Step team's free hosted API (needs the ACESTEP_API_KEY secret; skipped when it isn't set),
  2. ACE-Step 1.5 turbo on the runner's CPU (no GPU, no account, about 2.5 min a take),
  3. if both fail, nothing is uploaded and the player keeps the last good take.
Each take is retried with a new seed until Whisper hears at least 85% of the words, every line (outro included)
is there and no line is sung twice. The best take wins. Demucs then splits the voice from the music and they are
remixed with the voice upfront: voice +4 dB, the music dipped around 1 to 4 kHz and ducked a little while the voice
sings, then loudness-matched to -14 LUFS. Whisper's word timestamps on the separated voice time the lyrics.

A take is two files on the rolling "visitor-song" release: visitor-take.mp3 and visitor-take.json (the line and word
timings, which engine sang it, and a hash of the lyrics it was made from). scripts/visitor_song.py uses them.

Usage:
  visitor_take.py --check              prints needed=true|false (is the last take for different lyrics?)
  visitor_take.py --cloud OUT_DIR      sing on acemusic.ai; writes OUT_DIR/visitor-take.{mp3,json} when a take passes
  visitor_take.py --cpu OUT_DIR        the same with ACE-Step on this machine's CPU (ACE_STEP_DIR = a checkout)
  visitor_take.py --prepare-cpu        download the CPU models (bf16 copy of the turbo DiT; skips the unused LM)
Exits 0 when a take was written or the step was skipped on purpose, 1 when it tried and failed.
"""
import argparse
import base64
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import USER  # noqa: E402

RELEASE = "visitor-song"
NAME = "visitor-take"
TAKE_URL = f"https://github.com/{USER}/{USER}/releases/download/{RELEASE}/"
API = "https://api.acemusic.ai/v1/chat/completions"
VERSION = 1  # bump to re-sing the song after changing the brief or the mix
BPM, KEY = 96, "A minor"
CAPTION = ("intimate indie pop ballad, 96 BPM, A minor, 4/4. Male lead vocal upfront and dry, clear diction, every word "
           "sung clearly and unhurried, close-mic warm voice. Sparse arrangement kept low under the voice: soft felt piano, "
           "gentle warm pad, light brushed drums, soft round bass, lots of space around the vocal. Cinematic, warm, mellow, "
           "no backing vocals, no ad-libs.")
CPU_LM = "acestep-5Hz-lm-0.6B"
CLOUD_BUDGET = int(os.environ.get("ACEMUSIC_BUDGET", "900"))  # seconds of retrying a busy acemusic.ai before the CPU
TRIES = int(os.environ.get("VISITOR_TAKE_TRIES", "4"))
GOOD, FLOOR = 0.85, 0.75   # aim for 85% of words heard; never publish below 75%
SR = 44100


# ---------- the lyrics ----------

def sheet():
    """[(section, text, who)] in singing order, from visitor_song's lyric sheet (or, for the contribution song,
    from the lines file contribution_song.py writes)."""
    if os.environ.get("TAKE_LINES"):
        with open(os.environ["TAKE_LINES"]) as f:
            return json.load(f)["lines"]
    import visitor_song as VS
    state = VS.load_state()
    return [dict(section=name, text=it[0], who=it[1]) for name, items in VS.lyric_sheet(state["entries"]) for it in items]


def ace_lyrics(lines):
    out, sec = ["[intro]", ""], None
    for ln in lines:
        if ln["section"] != sec:
            out += ["", f"[{ln['section'].lower()}]"]
            sec = ln["section"]
        out.append(ln["text"])
    return "\n".join(out).strip() + "\n"


def duration(lines):
    if os.environ.get("TAKE_LINES"):
        with open(os.environ["TAKE_LINES"]) as f:
            return int(round(json.load(f)["length"]))
    return int(round(10 + 5 * len(lines) + 10))  # an intro, two bars a line at 96 BPM, a short outro


def lyrics_hash(lines):
    key = json.dumps(dict(v=VERSION, caption=CAPTION, lyrics=ace_lyrics(lines), who=[ln["who"] for ln in lines]), sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def last_take():
    try:
        with urllib.request.urlopen(urllib.request.Request(TAKE_URL + NAME + ".json",
                                                           headers={"User-Agent": f"{USER}-visitor-song"}), timeout=30) as r:
            return json.load(r)
    except Exception:  # noqa: BLE001
        return None


# ---------- engines ----------

def cpu_bf16():
    """bf16 is only fast on CPUs with native bf16 maths (AVX512-BF16 or AMX); elsewhere, such as most GitHub runners,
    PyTorch emulates it and the LM alone takes about 20 minutes, so those run in float32."""
    try:
        flags = open("/proc/cpuinfo").read()
    except OSError:
        return False
    return "avx512_bf16" in flags or "amx_bf16" in flags


class Failed(Exception):
    pass


CLOUD = {"think": os.environ.get("ACEMUSIC_THINKING", "1") != "0"}


def sing_cloud(lyrics, dur, seed, key):
    """One take from acemusic.ai.
    The API sends nothing (not even headers, despite stream=true) until the song is done, and Cloudflare in front of
    it gives up at about 60 s with a 504. With the LM planning ("thinking") a take takes 35-60 s, so a busy server tips
    it over; without it a take takes about 17 s. So after a 504 the next tries skip the LM."""
    body = dict(model="acemusic/acestep-v15-turbo", stream=True, seed=seed, thinking=CLOUD["think"],
                messages=[dict(role="user", content=CAPTION)], lyrics=lyrics,
                audio_config=dict(duration=dur, bpm=BPM, key_scale=KEY, time_signature="4", vocal_language="en", format="mp3"))
    req = urllib.request.Request(API, json.dumps(body).encode(), {
        "Content-Type": "application/json", "Authorization": "Bearer " + key,
        "User-Agent": "curl/8.5.0"})  # Cloudflare turns away Python's default user agent (error 1010)
    audio, t0 = None, time.time()
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:") or line == "data: [DONE]":
                    continue
                d = json.loads(line[5:])
                if d.get("error"):
                    raise Failed(f"acemusic.ai: {d['error']}")
                for c in d.get("choices", []):
                    a = (c.get("delta") or {}).get("audio") or (c.get("message") or {}).get("audio")
                    if a:
                        audio = a[0]["audio_url"]["url"]
    except urllib.error.HTTPError as e:
        if e.code == 504 and CLOUD["think"]:
            CLOUD["think"] = False
            raise Failed(f"acemusic.ai HTTP 504 after {time.time() - t0:.0f} s (Cloudflare's ~60 s limit); "
                         "the next tries skip the LM planning so they finish in time") from None
        raise Failed(f"acemusic.ai HTTP {e.code} after {time.time() - t0:.0f} s: {e.read()[:200]!r}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise Failed(f"acemusic.ai: {e}") from None
    if not audio:
        raise Failed("acemusic.ai sent no audio")
    return base64.b64decode(audio.split(",", 1)[1]), "mp3"


class CpuSinger:
    def __init__(self):
        root = os.environ.get("ACE_STEP_DIR", os.path.expanduser("~/ace-step"))
        sys.path.insert(0, root)
        import acestep.model_downloader as md
        md.MAIN_MODEL_COMPONENTS = [c for c in md.MAIN_MODEL_COMPONENTS if "-lm-" not in c]  # the LM isn't used
        from acestep.handler import AceStepHandler
        from acestep.inference import GenerationConfig, GenerationParams, generate_music
        from acestep.llm_inference import LLMHandler
        self.P, self.C, self.gen = GenerationParams, GenerationConfig, generate_music
        self.dit, self.lm = AceStepHandler(), LLMHandler()
        msg = self.dit.initialize_service(project_root=root, config_path="acestep-v15-turbo", device="cpu")
        if self.dit.model is None:
            raise Failed(f"ACE-Step didn't load: {msg}")
        # the small 5 Hz LM plans the song from the lyrics first; without it the turbo DiT often skips lines
        self.think = False
        try:
            import torch
            m, ok = self.lm.initialize(checkpoint_dir=os.path.join(root, "checkpoints"), lm_model_path=CPU_LM, backend="pt",
                                       device="cpu", dtype=torch.bfloat16 if cpu_bf16() else torch.float32)
            self.think = bool(ok)
            print(f"LM {CPU_LM}: {'ready' if ok else m}")
        except Exception as e:  # noqa: BLE001
            print(f"LM {CPU_LM} unavailable ({e}), singing without it")
        self.out = tempfile.mkdtemp()

    def __call__(self, lyrics, dur, seed):
        p = self.P(caption=CAPTION, lyrics=lyrics, bpm=BPM, keyscale=KEY, timesignature="4", vocal_language="en",
                   duration=dur, inference_steps=8, seed=seed, thinking=self.think)
        r = self.gen(self.dit, self.lm, p, self.C(batch_size=1, audio_format="wav", use_random_seed=False), save_dir=self.out)
        if not r.success or not r.audios:
            raise Failed(f"ACE-Step CPU: {getattr(r, 'error', 'no audio')}")
        a = r.audios[0]
        path = a.get("path") if isinstance(a, dict) else a
        with open(path, "rb") as f:
            return f.read(), "wav"


def prepare_cpu():
    """The DiT, VAE and text encoder from ACE-Step/Ace-Step1.5 (not its 3.5 GB LM) plus the small 0.6B LM, with the
    DiT stored as bf16 so the cached copy is about 5 GB, and the turbo model runs in bf16 on the CPU."""
    from huggingface_hub import snapshot_download
    root = os.environ.get("ACE_STEP_DIR", os.path.expanduser("~/ace-step"))
    ck = os.path.join(root, "checkpoints")
    w = os.path.join(ck, "acestep-v15-turbo", "model.safetensors")
    if not os.path.exists(os.path.join(ck, ".bf16")):
        snapshot_download("ACE-Step/Ace-Step1.5", local_dir=ck,
                          allow_patterns=["config.json", "acestep-v15-turbo/*", "vae/*", "Qwen3-Embedding-0.6B/*"])
        import torch
        from safetensors.torch import load_file, save_file
        sd = load_file(w)
        save_file({k: (v.to(torch.bfloat16) if v.is_floating_point() else v).contiguous() for k, v in sd.items()}, w + ".tmp",
                  metadata={"format": "pt"})
        os.replace(w + ".tmp", w)
        open(os.path.join(ck, ".bf16"), "w").close()
    if not os.path.exists(os.path.join(ck, CPU_LM, "config.json")):
        snapshot_download(f"ACE-Step/{CPU_LM}", local_dir=os.path.join(ck, CPU_LM))
    # ACE-Step picks float32 on CPU. Where the CPU does bf16 natively, bf16 halves the memory and sings the same;
    # elsewhere float32 is much faster (the weights are cached as bf16 either way and upcast when loaded)
    print(f"CPU bf16: {'native, using bf16' if cpu_bf16() else 'emulated, using float32'}")
    if not cpu_bf16():
        return
    f = os.path.join(root, "acestep", "core", "generation", "handler", "init_service_orchestrator.py")
    src = open(f).read()
    new = src.replace('torch.bfloat16 if resolved_device == "xpu" else torch.float32',
                      'torch.bfloat16 if resolved_device in ("xpu", "cpu") else torch.float32')
    if new == src and '("xpu", "cpu")' not in src:
        print("warning: couldn't switch ACE-Step to bf16 on CPU; it will run in float32")
    open(f, "w").write(new)


# ---------- audio helpers ----------

def decode(path, sr=SR, mono=False):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1" if mono else "2", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    return x if mono else x.reshape(-1, 2).T.copy()


def write_wav(path, x, sr=SR):
    from scipy.io import wavfile
    wavfile.write(path, sr, np.clip(x.T, -1, 1).astype(np.float32))


def separate(path, d):
    """Demucs (htdemucs, CPU): returns (vocals, music), both stereo at SR."""
    subprocess.run([sys.executable, "-m", "demucs.separate", "-n", "htdemucs", "--two-stems", "vocals", "-o", d, path],
                   check=True, capture_output=True)
    base = os.path.join(d, "htdemucs", os.path.splitext(os.path.basename(path))[0])
    return decode(os.path.join(base, "vocals.wav")), decode(os.path.join(base, "no_vocals.wav"))


def peaking(x, f0, gain_db, q):
    from scipy import signal
    a = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * a, -2 * np.cos(w), 1 - al * a]
    den = [1 + al / a, -2 * np.cos(w), 1 - al / a]
    return signal.lfilter(b, den, x, axis=-1)


def envelope(x, ms=60):
    m = np.sqrt(np.convolve(np.mean(x, axis=0) ** 2, np.ones(int(SR * ms / 1000)) / int(SR * ms / 1000), mode="same"))
    return m


def db(x):
    return 20 * np.log10(max(float(x), 1e-9))


def balance(v, m):
    """Voice-to-music level in dB, measured only where the voice is singing."""
    ev = envelope(v)
    on = ev > ev.max() * 0.1
    if not on.any():
        return -99.0
    return db(np.sqrt(np.mean(np.mean(v, 0)[on] ** 2))) - db(np.sqrt(np.mean(np.mean(m, 0)[on] ** 2)))


def polish(v, m):
    """The voice upfront: voice +4 dB with a little presence, the music dipped where the voice lives and ducked
    up to 4 dB while it sings. Returns the mix and the voice-to-music balance before and after."""
    from scipy import signal
    before = balance(v, m)
    v2 = signal.sosfilt(signal.butter(2, 90, "highpass", fs=SR, output="sos"), v, axis=-1)
    v2 = peaking(v2, 3500, 2.0, 0.8) * 10 ** (4 / 20)
    m2 = peaking(peaking(m, 2500, -4.0, 0.7), 1000, -2.0, 0.9)
    ev = envelope(v2, 80)
    duck = 10 ** (-4 * np.clip(ev / (np.percentile(ev, 90) + 1e-9), 0, 1) / 20)
    m2 = m2 * duck
    return v2 + m2, before, balance(v2, m2)


def master(mix, out_mp3):
    """-14 LUFS, true peak under -1.5 dBTP, 192 kbps."""
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, "m.wav")
        write_wav(w, mix / (np.max(np.abs(mix)) + 1e-9) * 0.9)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR),
                        "-codec:a", "libmp3lame", "-b:a", "192k", "-map_metadata", "-1", out_mp3], check=True)
    st = subprocess.run(["ffmpeg", "-hide_banner", "-i", out_mp3, "-af", "ebur128=peak=true", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", st)
    pk = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", st)
    return (float(i[-1]) if i else None), (float(pk[-1]) if pk else None)


# ---------- checking a take ----------

_whisper = None


def words_heard(audio16):
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel(os.environ.get("VISITOR_WHISPER", "small.en"), device="cpu", compute_type="int8")
    segs, _ = _whisper.transcribe(audio16, language="en", word_timestamps=True, vad_filter=False, beam_size=5)
    return [(w.word.strip(), w.start, w.end) for s in segs for w in (s.words or [])]


def norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))


def check(lines, heard):
    """Matches what Whisper heard to the lyrics. Returns a report with accuracy, missing and repeated lines,
    and a time for every lyric word."""
    ref = [(i, norm(w), w) for i, ln in enumerate(lines) for w in ln["text"].split() if norm(w)]
    hyp = [(norm(w), s, e) for w, s, e in heard if norm(w)]
    sm = difflib.SequenceMatcher(None, [r[1] for r in ref], [h[0] for h in hyp], autojunk=False)
    exact, near = {}, {}
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == "equal":
            exact.update({a0 + k: b0 + k for k in range(a1 - a0)})
        elif op == "replace":  # a misheard word still marks when it was sung
            near.update({a0 + k: b0 + k for k in range(min(a1 - a0, b1 - b0))})
    used = set(exact.values()) | set(near.values())
    acc = len(exact) / max(1, len(ref))
    missing = [ln["text"] for i, ln in enumerate(lines)
               if sum(1 for k, r in enumerate(ref) if r[0] == i and k in exact) < 0.6 * sum(1 for r in ref if r[0] == i)]
    # a lyric line sung again where the lyrics don't have it: a run of unmatched heard words that reads like a line
    runs, cur = [], []
    for j, h in enumerate(hyp):
        if j in used:
            if cur:
                runs.append(cur)
            cur = []
        else:
            cur.append(h[0])
    if cur:
        runs.append(cur)
    repeated = []
    for run in runs:
        for ln in lines:
            lw = [norm(w) for w in ln["text"].split() if norm(w)]
            if len(lw) < 3 or len(run) < len(lw) - 1:
                continue
            for s in range(0, max(1, len(run) - len(lw) + 2)):
                if difflib.SequenceMatcher(None, lw, run[s:s + len(lw)]).ratio() >= 0.75:
                    repeated.append(ln["text"])
                    break
    extra = (len(hyp) - len(used)) / max(1, len(ref))
    # word times: from the heard word where there is one, otherwise spread between neighbours
    t = [None] * len(ref)
    for k in range(len(ref)):
        j = exact.get(k, near.get(k))
        if j is not None:
            t[k] = (hyp[j][1], hyp[j][2])
    known = [k for k in range(len(ref)) if t[k]]
    if known:
        for k in range(len(ref)):
            if t[k] is None:
                lo = max([q for q in known if q < k], default=None)
                hi = min([q for q in known if q > k], default=None)
                if lo is not None and hi is not None:
                    s = t[lo][1] + (t[hi][0] - t[lo][1]) * (k - lo) / (hi - lo)
                elif lo is not None:
                    s = t[lo][1] + 0.35 * (k - lo)
                else:
                    s = max(0.0, t[hi][0] - 0.35 * (hi - k))
                t[k] = (s, s + 0.3)
    score = acc - 0.5 * extra - 0.2 * len(missing) - 0.2 * len(repeated)
    return dict(accuracy=round(acc, 4), extra=round(extra, 4), missing=missing, repeated=sorted(set(repeated)),
                score=score, ok=bool(known) and not missing and not repeated,
                good=bool(known) and not missing and not repeated and acc >= GOOD,
                words=[(ref[k][0], ref[k][2], t[k]) for k in range(len(ref))] if known else [],
                heard=" ".join(w for w, _, _ in heard))


def timed_lines(lines, words):
    out = []
    for i, ln in enumerate(lines):
        ws = [(w, s, e) for li, w, (s, e) in words if li == i]
        out.append(dict(section=ln["section"], text=ln["text"], who=ln["who"], t=round(ws[0][1], 3),
                        end=round(ws[-1][2], 3), words=[[w, round(s, 3)] for w, s, _ in ws]))
    for a, b in zip(out, out[1:]):  # keep lines in order and from overlapping
        b["t"] = max(b["t"], a["t"] + 0.5)
        a["end"] = min(max(a["end"], a["t"] + 0.6), b["t"])
    return out


# ---------- one run ----------

def run(engine, out_dir):
    lines = sheet()
    if not lines:
        print("no lyrics")
        return 1
    lyrics, dur, h = ace_lyrics(lines), duration(lines), lyrics_hash(lines)
    if engine == "cloud":
        key = os.environ.get("ACESTEP_API_KEY", "").strip()
        if not key:
            print("::warning::ACESTEP_API_KEY isn't set, so the cloud is skipped and the CPU sings")
            return 1
        sing, label = (lambda ly, du, sd: sing_cloud(ly, du, sd, key)), "acemusic.ai"
    else:
        try:
            sing, label = CpuSinger(), "ACE-Step 1.5 on CPU"
        except Exception as e:  # noqa: BLE001
            print(f"ACE-Step CPU unavailable: {e}")
            return 1
    os.makedirs(out_dir, exist_ok=True)
    best, fails, sung = None, 0, 0
    seed0 = int(h[:6], 16) % 100000
    tries = TRIES + (2 if engine == "cloud" else 0)  # cloud takes are quick, so reroll a few more before the CPU
    print(f"{label}: {len(lines)} lines, {dur} s of song requested, up to {tries} takes")
    start = time.time()
    for k in range(tries + (12 if engine == "cloud" else 0)):  # room for a few server errors on top of the takes
        seed = seed0 + 7919 * k
        t0 = time.time()
        try:
            data, ext = sing(lyrics, dur, seed)
        except Failed as e:
            fails += 1
            print(f"::warning::{label} take {k + 1} failed: {e}")
            if re.search(r"HTTP 40[0-3]", str(e)):  # a bad key or request won't get better by waiting
                break
            # a busy server answers every request with a 504 (even a 20 s song), so wait it out within a budget
            if time.time() - start > CLOUD_BUDGET:
                print(f"::warning::{label}: still failing after {CLOUD_BUDGET // 60} min, giving up")
                break
            time.sleep(min(120, 30 * fails))  # back off: 30, 60, 90, 120 s
            continue
        took = time.time() - t0
        sung += 1
        with tempfile.TemporaryDirectory() as d:
            raw = os.path.join(d, f"take.{ext}")
            open(raw, "wb").write(data)
            try:
                x = decode(raw)
            except subprocess.CalledProcessError:
                print(f"take {k + 1}: unreadable audio")
                continue
            if x.shape[1] < SR * dur * 0.6 or np.sqrt(np.mean(x ** 2)) < 1e-3:
                print(f"take {k + 1}: too short or silent")
                continue
            v, m = separate(raw, d)
            from scipy import signal
            v16 = signal.resample_poly(np.mean(v, 0), 160, 441).astype(np.float32)
            rep = check(lines, words_heard(v16))
            print(f"take {k + 1} (seed {seed}, made in {took:.0f} s, {x.shape[1] / SR:.0f} s long): {rep['accuracy']:.1%} of words, extra {rep['extra']:.1%}, "
                  f"missing {len(rep['missing'])}, repeated {len(rep['repeated'])}")
            if best is None or rep["score"] > best[0]["score"]:
                mix, before, after = polish(v, m)
                best = (rep, seed, mix, before, after, took)
                write_wav(os.path.join(out_dir, NAME + "-vocals.wav"), v)
        if (best and best[0]["good"]) or sung >= tries:
            break
    if not best or not best[0]["ok"] or best[0]["accuracy"] < FLOOR:
        print(f"::warning::{label}: no take was good enough" + (f" (best {best[0]['accuracy']:.1%}, missing {best[0]['missing']}, "
                                           f"repeated {best[0]['repeated']})" if best else ""))
        return 1
    rep, seed, mix, before, after, took = best
    mp3 = os.path.join(out_dir, NAME + ".mp3")
    lufs, peak = master(mix, mp3)
    final = check(lines, words_heard(decode(mp3, 16000, mono=True)))  # what listeners hear, after the mix
    take = dict(hash=h, engine=label, model="ACE-Step 1.5 turbo (acestep-v15-turbo)", seed=seed, bpm=BPM, key=KEY,
                caption=CAPTION, made=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                length=round(mix.shape[1] / SR, 3), accuracy_voice=rep["accuracy"], accuracy_mix=final["accuracy"],
                balance_db=dict(before=round(before, 1), after=round(after, 1)), lufs=lufs, peak_db=peak,
                seconds=round(took, 1), lines=timed_lines(lines, rep["words"]))
    with open(os.path.join(out_dir, NAME + ".json"), "w") as f:
        json.dump(take, f, indent=1)
    print(f"take written: {label}, seed {seed}, {rep['accuracy']:.1%} of words (voice), {final['accuracy']:.1%} (mix), "
          f"voice {before:+.1f} -> {after:+.1f} dB over the music, {lufs} LUFS")
    print("heard:", rep["heard"])
    return 0


CONTRIB_CAPTION = ("hip hop, 140 BPM half-time, A minor, 4/4. Confident male rap verses and a warm female sung chorus, "
                   "lead vocal upfront and dry, clear diction, every word clear and on the beat. Sparse beat kept low under "
                   "the voice: soft 808, light hats, airy pad. No ad-libs, no backing vocals.")


def use_contribution():
    """Switch to the contribution song: its own release, brief, tempo and the lines file from contribution_song.py."""
    global RELEASE, NAME, TAKE_URL, BPM, CAPTION
    RELEASE, NAME, BPM, CAPTION = "contribution-song-take", "contribution-take", 140, CONTRIB_CAPTION
    TAKE_URL = f"https://github.com/{USER}/{USER}/releases/download/{RELEASE}/"
    os.environ.setdefault("TAKE_LINES", "/tmp/contribution-lines.json")


def main():
    sys.stdout.reconfigure(line_buffering=True)  # progress shows up in the Actions log as it happens
    if "--contribution" in sys.argv:
        sys.argv.remove("--contribution")
        use_contribution()
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--cloud", metavar="OUT_DIR")
    g.add_argument("--cpu", metavar="OUT_DIR")
    g.add_argument("--prepare-cpu", action="store_true")
    a = ap.parse_args()
    if a.check:
        lines = sheet()
        last = last_take()
        need = bool(lines) and (not last or last.get("hash") != lyrics_hash(lines))
        print(f"needed={'true' if need else 'false'}")
        return 0
    if a.prepare_cpu:
        prepare_cpu()
        return 0
    return run("cloud" if a.cloud else "cpu", a.cloud or a.cpu)


if __name__ == "__main__":
    sys.exit(main())
