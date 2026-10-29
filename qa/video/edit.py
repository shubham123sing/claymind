"""
Cut the demo footage (qa/e2e/demo.spec.ts) into the submission video (docs/SUBMISSION.md):
title card, the scenes (long ones sped up, at most 3x (4x for menu-only scenes)), the two players side by side, a
"how it works" card and an end card. 1080p, 30 fps, H.264, a silent audio track.

  python qa/video/edit.py qa/recordings/demo-<time> [out.mp4]

Needs an ffmpeg with libx264 and drawtext: FFMPEG=<path>, or the imageio-ffmpeg package.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

W, H, FPS = 1920, 1080, 30
FONT = 'C\\:/Windows/Fonts/segoeui.ttf' if os.name == 'nt' else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = 'C\\:/Windows/Fonts/segoeuib.ttf' if os.name == 'nt' else FONT
LINK = 'shubham123sing.github.io/claymind'
# longest each scene may run in the video (s); longer footage is sped up, at most 3x (4x for menu-only scenes)
MAX = {'sculpt': 34, 'life': 14, 'game': 34, 'keep': 22, 'comfort': 12, 'room': 7, 'join': 12, 'shared': 12}
# menu-only scenes may go faster than 3x
FAST = {'keep': 4.0, 'room': 4.0, 'join': 4.0}
# closer shots (crop w, h, x, y of the 1080p frame) where the clay is small on the table; the caption stays in
ZOOM = {'sculpt': (1280, 720, 320, 360), 'life': (1280, 720, 320, 360), 'game': (1440, 810, 240, 270)}
ORDER = ['sculpt', 'life', 'game', 'room', 'join', 'shared', 'keep', 'comfort']


def ffmpeg() -> str:
    if os.environ.get('FFMPEG'):
        return os.environ['FFMPEG']
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(args: list[str]) -> None:
    subprocess.run([ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def text_file(tmp: Path, name: str, text: str) -> str:
    p = tmp / f'{name}.txt'
    p.write_text(text, encoding='utf-8')
    return str(p).replace('\\', '/').replace(':', '\\:')


def card(tmp: Path, name: str, secs: float, lines: list[tuple[str, int, bool, str]]) -> Path:
    """A still card: lines of (text, size, bold, colour), centred as a block."""
    gap = 26
    total = sum(s for _, s, _, _ in lines) + gap * (len(lines) - 1)
    y = (H - total) // 2
    draws = []
    for i, (t, size, bold, col) in enumerate(lines):
        f = text_file(tmp, f'{name}{i}', t)
        draws.append(f"drawtext=fontfile='{BOLD if bold else FONT}':textfile='{f}':fontsize={size}:fontcolor={col}:x=(w-text_w)/2:y={y}")
        y += size + gap
    out = tmp / f'{name}.mp4'
    vf = ','.join(draws) + f',fade=in:0:{FPS // 2},fade=out:st={secs - 0.5}:d=0.5'
    run(['-f', 'lavfi', '-i', f'color=c=0x15181d:s={W}x{H}:r={FPS}:d={secs}', '-vf', vf, *enc(), str(out)])
    return out


def enc() -> list[str]:
    return ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS)]


def duration(p: Path) -> float:
    r = subprocess.run([ffmpeg(), '-hide_banner', '-i', str(p)], capture_output=True, text=True)
    h, m, sec = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr).groups()
    return int(h) * 3600 + int(m) * 60 + float(sec)


def speed_of(scene: str, dur: float) -> float:
    return min(FAST.get(scene, 3.0), max(1.0, dur / MAX.get(scene, dur)))


def clip(tmp: Path, src: Path, name: str, a: float, b: float, scene: str) -> Path:
    sp = speed_of(scene, b - a)
    out = tmp / f'{name}.mp4'
    d = (b - a) / sp
    z = ZOOM.get(scene)
    crop = f'crop={z[0]}:{z[1]}:{z[2]}:{z[3]},' if z else ''
    vf = f'setpts=(PTS-STARTPTS)/{sp:.3f},{crop}scale={W}:{H}:flags=lanczos,fps={FPS},fade=in:0:8,fade=out:st={max(0, d - 0.3):.2f}:d=0.3'
    run(['-ss', f'{a:.2f}', '-to', f'{b:.2f}', '-i', str(src), '-vf', vf, '-an', *enc(), str(out)])
    return out


def side_by_side(tmp: Path, a: Path, b: Path, ma: dict, mb: dict) -> Path:
    """Both players at once: player 1 left, player 2 right, labelled."""
    dur = min(ma['to'] - ma['from'], mb['to'] - mb['from'])
    sp = speed_of('shared', dur)
    d = dur / sp
    out = tmp / 'shared.mp4'
    l1, l2 = text_file(tmp, 'p1', 'Player 1'), text_file(tmp, 'p2', 'Player 2')
    lab = f":fontsize=40:fontcolor=white:box=1:boxcolor=0x000000@0.55:boxborderw=14:y=190"
    fc = (
        f'[0:v]trim=start={ma["from"]:.2f}:duration={dur:.2f},setpts=(PTS-STARTPTS)/{sp:.3f},scale=950:-2[a];'
        f'[1:v]trim=start={mb["from"]:.2f}:duration={dur:.2f},setpts=(PTS-STARTPTS)/{sp:.3f},scale=950:-2[b];'
        f'color=c=0x15181d:s={W}x{H}:r={FPS}:d={d:.2f}[bg];'
        f'[bg][a]overlay=x=7:y=(H-h)/2:shortest=1[t];[t][b]overlay=x=963:y=(H-h)/2:shortest=1,'
        f"drawtext=fontfile='{BOLD}':textfile='{l1}'{lab}:x=7+(950-text_w)/2,"
        f"drawtext=fontfile='{BOLD}':textfile='{l2}'{lab}:x=963+(950-text_w)/2,"
        f'fps={FPS},fade=in:0:8,fade=out:st={max(0, d - 0.3):.2f}:d=0.3[v]'
    )
    run(['-i', str(a), '-i', str(b), '-filter_complex', fc, '-map', '[v]', '-t', f'{d:.2f}', *enc(), str(out)])
    return out


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src / 'claymind-demo.mp4'
    m = json.loads((src / 'marks.json').read_text())['marks']
    find = lambda page, scene: next((x for x in m if x['page'] == page and x['scene'] == scene), None)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        parts = [card(tmp, 'title', 5, [
            ('ClayMind', 120, True, 'white'),
            ('Sculpt clay with your bare hands in VR, bring it to life,', 44, False, '0xdfe5ec'),
            ('and turn it into a game to play alone or with friends.', 44, False, '0xdfe5ec'),
            ('Recorded in the WebXR emulator in a desktop browser, not on a headset.', 30, False, '0x9aa7b4'),
        ])]
        for s in ORDER:
            if s == 'shared':
                ma, mb = find('A', 'shared'), find('B', 'shared')
                if ma and mb:
                    parts.append(side_by_side(tmp, src / 'A.webm', src / 'B.webm', ma, mb))
                continue
            page = 'B' if s == 'join' else 'A'
            x = find(page, s)
            if x and x['to'] - x['from'] > 1:
                parts.append(clip(tmp, src / f'{page}.webm', s, x['from'], x['to'], s))
        parts.append(card(tmp, 'how', 7, [
            ('How it works', 64, True, 'white'),
            ('Physics and games run on your device.', 42, False, '0xdfe5ec'),
            ('The AI only fills a checked game form. It never writes code.', 42, False, '0xdfe5ec'),
            ('Hands only, seated. No controllers, no voice.', 42, False, '0xdfe5ec'),
            ('Not yet tested on a Quest. Multiplayer is beta.', 34, False, '0x9aa7b4'),
        ]))
        parts.append(card(tmp, 'end', 5, [
            ('ClayMind', 110, True, 'white'),
            (LINK, 48, False, '0x8fd19e'),
            ('Hands only. Free.', 44, False, '0xdfe5ec'),
        ]))
        lst = tmp / 'list.txt'
        lst.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts))
        silent = tmp / 'silent.mp4'
        run(['-f', 'concat', '-safe', '0', '-i', str(lst), '-c:v', 'copy', str(silent)])
        # the music (music.py, made here) for exactly the video's length
        secs = sum(duration(p) for p in parts)
        wav = tmp / 'music.wav'
        subprocess.run([sys.executable, str(Path(__file__).with_name('music.py')), f'{secs:.2f}', str(wav)], check=True, stdout=subprocess.DEVNULL)
        run(['-i', str(silent), '-i', str(wav), '-map', '0:v', '-map', '1:a', '-shortest', '-c:v', 'copy',
             '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(out)])
    print(out)


if __name__ == '__main__':
    main()
