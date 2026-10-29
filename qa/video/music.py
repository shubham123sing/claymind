"""
Background music for the demo video, made here from scratch (no samples, no outside tracks, so no
licence questions): a light, warm loop at 100 bpm. Chords C - G - Am - F as a soft pad, a plucked
arpeggio, a round bass and a gentle beat; fades in and out.

  python qa/video/music.py <seconds> out.wav
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
# C, G, Am, F (MIDI notes)
CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]


def hz(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n: int, a: float, r: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)


def tone(f: float, secs: float, a: float, r: float, bright: float = 0.3) -> np.ndarray:
    n = int(secs * SR)
    t = np.arange(n) / SR
    w = np.sin(2 * np.pi * f * t) + bright * np.sin(4 * np.pi * f * t) + bright * 0.4 * np.sin(6 * np.pi * f * t)
    return w * env(n, a, r)


def add(buf: np.ndarray, x: np.ndarray, at: float, gain: float) -> None:
    i = int(at * SR)
    j = min(len(buf), i + len(x))
    if i < j:
        buf[i:j] += x[: j - i] * gain


def make(secs: float) -> np.ndarray:
    n = int(secs * SR)
    L, R = np.zeros(n), np.zeros(n)
    bars = int(secs / BAR) + 1
    for b in range(bars):
        t0 = b * BAR
        ch = CHORDS[b % 4]
        intro = b < 2  # the first two bars: pad only
        # pad: the chord, slow attack, slightly apart in the two ears
        for k, note in enumerate(ch):
            p = tone(hz(note), BAR + 0.6, 0.5, 2.5, 0.15)
            add(L, p, t0, 0.05 if k != 2 else 0.035)
            add(R, p, t0, 0.035 if k != 2 else 0.05)
        # bass: root on beats 1 and 3
        for beat in (0, 2):
            add(L, tone(hz(ch[0] - 24), BEAT * 1.8, 0.01, 0.5, 0.5), t0 + beat * BEAT, 0.16)
            add(R, tone(hz(ch[0] - 24), BEAT * 1.8, 0.01, 0.5, 0.5), t0 + beat * BEAT, 0.16)
        if intro:
            continue
        # arpeggio: eighth notes up and down the chord, an octave up
        seq = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2], ch[1], ch[0] + 12, ch[2]]
        for k, note in enumerate(seq):
            pl = tone(hz(note + 12), BEAT, 0.003, 0.18, 0.45)
            pan = 0.5 + 0.3 * np.sin(k / 8 * 2 * np.pi)
            add(L, pl, t0 + k * BEAT / 2, 0.07 * (1 - pan) * 2)
            add(R, pl, t0 + k * BEAT / 2, 0.07 * pan * 2)
        # beat: a soft kick on 1 and 3, a shaker on the off-beats
        for beat in range(4):
            if beat % 2 == 0:
                m = int(0.25 * SR)
                t = np.arange(m) / SR
                kick = np.sin(2 * np.pi * (50 + 70 * np.exp(-t * 30)) * t) * np.exp(-t * 14)
                add(L, kick, t0 + beat * BEAT, 0.22)
                add(R, kick, t0 + beat * BEAT, 0.22)
            m = int(0.06 * SR)
            sh = np.random.default_rng(b * 4 + beat).standard_normal(m) * np.exp(-np.arange(m) / SR * 60)
            sh = np.diff(sh, prepend=0)  # brighter
            add(L, sh, t0 + (beat + 0.5) * BEAT, 0.018)
            add(R, sh, t0 + (beat + 0.5) * BEAT, 0.024)
    out = np.stack([L, R], 1)
    # fade in 2 s, out 3 s; normalise to -3 dB
    t = np.arange(n) / SR
    fade = np.minimum(1, t / 2) * np.minimum(1, (secs - t) / 3).clip(0)
    out *= fade[:, None]
    out *= 0.7 / max(1e-9, np.abs(out).max())
    return out


def main() -> None:
    secs, path = float(sys.argv[1]), sys.argv[2]
    pcm = (make(secs) * 32767).astype('<i2')
    with wave.open(path, 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print(path)


if __name__ == '__main__':
    main()
