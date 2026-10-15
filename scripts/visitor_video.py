"""The visitor song as a video for the Videos page: a still card with the title and credits, a waveform that
moves with the audio, and the song's MP3. Writes visitor-song.mp4 and visitor-poster.jpg into the given folder.
Needs ffmpeg and Pillow (both already installed by the profile-cards workflow)."""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "assets")
W, H = 1280, 720
BG, INK = (227, 251, 29), (17, 17, 17)


def font(size, bold=False):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              os.path.join(ROOT, "player", "fonts", "bricolage-grotesque.woff2")):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def envelope(mp3, n=142):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    import array
    a = array.array("h", raw)
    step = max(1, len(a) // n)
    peaks = [max((abs(v) for v in a[i:i + step]), default=0) for i in range(0, step * n, step)]
    top = max(peaks) or 1
    return [p / top for p in peaks]


def card(data, path, env=None):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((72, 64), "visitor", font=font(132, True), fill=INK)
    d.text((72, 200), "song", font=font(132, True), fill=INK)
    n = data.get("stats", {}).get("total", 0)
    d.text((76, 360), f"{n} visitor note{'' if n == 1 else 's'} · {data.get('bpm', 96)} bpm · a minor", font=font(30), fill=INK)
    people = [x["user"] for x in data.get("notes", [])][-6:]
    if people:
        d.text((76, 404), "with " + ", ".join("@" + p for p in people), font=font(26), fill=INK)
    d.text((76, 640), "github.com/nishal21 · add a note from the profile", font=font(24), fill=INK)
    # a record peeking out on the right, flat
    d.ellipse((900, 70, 1220, 390), fill=(29, 29, 29))
    d.ellipse((1010, 180, 1110, 280), fill=BG)
    d.ellipse((1052, 222, 1068, 238), fill=(29, 29, 29))
    if env:  # static waveform, the playhead is drawn by ffmpeg
        bw = 1136 / len(env)
        for i, v in enumerate(env):
            h = max(3, int(v * 70))
            x = 72 + i * bw
            d.rectangle((x, 525 - h, x + bw * 0.55, 525 + h), fill=INK)
    im.save(path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    mp3 = os.path.join(ASSETS, "visitor-song.mp3")
    if not os.path.exists(mp3):
        sys.exit("visitor-song.mp3 not found")
    with open(os.path.join(ASSETS, "visitor-song.json")) as f:
        data = json.load(f)
    os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        bg = os.path.join(tmp, "bg.png")
        card(data, bg)
        Image.open(bg).convert("RGB").save(os.path.join(out, "visitor-poster.jpg"), quality=86)
        card(data, bg, envelope(mp3))
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3],
                                   capture_output=True, text=True, check=True).stdout.strip() or 30)
        # a playhead that walks across the waveform with the audio
        flt = (f"color=c=0xff5678:s=4x170:r=30[p];"
               f"[0:v][p]overlay=x='72+1136*t/{dur:.3f}':y=440:eval=frame:shortest=1,format=yuv420p[v]")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", bg, "-i", mp3,
                        "-filter_complex", flt, "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "28", "-tune", "stillimage", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
                        os.path.join(out, "visitor-song.mp4")], check=True)
    print(f"{out}/visitor-song.mp4 and visitor-poster.jpg written")


if __name__ == "__main__":
    main()
