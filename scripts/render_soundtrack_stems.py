from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SR = 44100
DURATION = 120
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "soundtrack"
OUT.mkdir(parents=True, exist_ok=True)


def clamp(value: float) -> float:
    return max(-1.0, min(1.0, value))


def pan(sample: float, pos: float) -> tuple[float, float]:
    pos = max(-1.0, min(1.0, pos))
    left = math.cos((pos + 1) * math.pi / 4)
    right = math.sin((pos + 1) * math.pi / 4)
    return sample * left, sample * right


def add_tone(buf: list[list[float]], freq: float, amp: float, start: float, attack: float, release: float, pan_pos: float, phase: float = 0.0) -> None:
    start_i = max(0, int(start * SR))
    end_i = min(len(buf[0]), int((start + attack + release) * SR))
    for i in range(start_i, end_i):
        t = (i - start_i) / SR
        if t < attack:
            env = (1 - math.cos(math.pi * t / attack)) * 0.5
        else:
            r = (t - attack) / max(0.001, release)
            env = math.exp(-4.2 * r)
        drift = 1 + math.sin(i * 0.000013 + phase) * 0.0018
        s = math.sin(2 * math.pi * freq * drift * i / SR + phase) * amp * env
        l, r = pan(s, pan_pos)
        buf[0][i] += l
        buf[1][i] += r


def add_bowed_cluster(buf: list[list[float]], freqs: list[float], amps: list[float], start: float, fade: float, pan_pos: float) -> None:
    phases = [random.random() * math.tau for _ in freqs]
    for freq, amp, phase in zip(freqs, amps, phases):
        add_tone(buf, freq, amp, start, fade, DURATION - start - fade, pan_pos, phase)


def add_bell(buf: list[list[float]], freqs: list[float], start: float, amp: float, pan_pos: float) -> None:
    for j, freq in enumerate(freqs):
        add_tone(buf, freq, amp / (j + 1), start, 0.08, 5.0 - j * 0.38, pan_pos, random.random() * math.tau)


def add_shimmer(buf: list[list[float]], freqs: list[float], amps: list[float], start: float, fade: float) -> None:
    phases = [random.random() * math.tau for _ in freqs]
    start_i = int(start * SR)
    for i in range(start_i, len(buf[0])):
        t = (i - start_i) / SR
        fade_env = min(1.0, t / fade)
        pulse = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(t * 0.19))
        for j, (freq, amp) in enumerate(zip(freqs, amps)):
            drift = 1 + math.sin(i * (0.000009 + j * 0.000001)) * 0.002
            s = math.sin(2 * math.pi * freq * drift * i / SR + phases[j]) * amp * fade_env * pulse
            l, r = pan(s, -0.8 + (1.6 * j / max(1, len(freqs) - 1)))
            buf[0][i] += l
            buf[1][i] += r


def add_wind_and_ruffles(buf: list[list[float]]) -> None:
    rng = random.Random(12)
    low_l = low_r = 0.0
    hp_l_prev = hp_r_prev = 0.0
    prev_l = prev_r = 0.0
    ruffle_events = []
    whoosh_events = []

    t = 0.0
    while t < DURATION:
        t += rng.uniform(2.5, 7.5)
        whoosh_events.append((t, rng.uniform(0.8, 1.8), rng.uniform(1.8, 4.6), rng.uniform(0.3, 0.72)))

    t = 0.0
    while t < DURATION:
        t += rng.expovariate(8.0)
        if rng.random() < 0.45:
            ruffle_events.append((int(t * SR), rng.uniform(0.012, 0.09), rng.uniform(0.018, 0.065), rng.uniform(-0.9, 0.9)))

    ruffle_index = 0
    active_ruffles: list[tuple[int, float, float, float]] = []
    whoosh_index = 0

    for i in range(len(buf[0])):
        sec = i / SR
        gust = 0.42 + 0.28 * math.sin(sec * 0.11) + 0.2 * math.sin(sec * 0.037 + 1.2)
        gust = max(0.12, min(1.0, gust))
        n_l = rng.uniform(-1, 1)
        n_r = rng.uniform(-1, 1)
        low_l = low_l * 0.996 + n_l * 0.004
        low_r = low_r * 0.996 + n_r * 0.004
        hp_l = (prev_l + n_l - hp_l_prev) * 0.995
        hp_r = (prev_r + n_r - hp_r_prev) * 0.995
        hp_l_prev, hp_r_prev = n_l, n_r
        prev_l, prev_r = hp_l, hp_r
        wind_l = (low_l * 2.0 + hp_l * 0.055) * gust
        wind_r = (low_r * 2.0 + hp_r * 0.055) * gust

        while whoosh_index < len(whoosh_events) and whoosh_events[whoosh_index][0] <= sec:
            whoosh_index += 1
        for start, rise, fall, amp in whoosh_events[max(0, whoosh_index - 4):whoosh_index + 2]:
            rel = sec - start
            if 0 <= rel <= rise + fall:
                env = rel / rise if rel < rise else math.exp(-3.6 * ((rel - rise) / fall))
                bright = rng.uniform(-1, 1) * amp * env * 0.085
                sweep = 0.5 + 0.5 * math.sin(rel * math.pi / max(0.1, rise + fall))
                l, r = pan(bright * (0.4 + sweep), math.sin(start) * 0.55)
                wind_l += l
                wind_r += r

        while ruffle_index < len(ruffle_events) and ruffle_events[ruffle_index][0] <= i:
            active_ruffles.append(ruffle_events[ruffle_index])
            ruffle_index += 1
        next_active = []
        for start_i, decay, amp, pos in active_ruffles:
            age = (i - start_i) / SR
            if age < decay * 5:
                env = math.exp(-age / decay)
                paper = rng.uniform(-1, 1) * amp * env
                l, r = pan(paper, pos)
                wind_l += l
                wind_r += r
                next_active.append((start_i, decay, amp, pos))
        active_ruffles = next_active

        buf[0][i] += wind_l * 0.44
        buf[1][i] += wind_r * 0.44


def write_wav(path: Path, buf: list[list[float]], gain: float) -> None:
    peak = max(max(abs(x) for x in channel) for channel in buf) or 1.0
    scale = gain / peak
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        frames = bytearray()
        for l, r in zip(buf[0], buf[1]):
            frames += struct.pack("<hh", int(clamp(l * scale) * 32767), int(clamp(r * scale) * 32767))
        wav.writeframes(frames)


def empty() -> list[list[float]]:
    return [[0.0] * (SR * DURATION), [0.0] * (SR * DURATION)]


def render() -> None:
    random.seed(4)

    base = empty()
    add_wind_and_ruffles(base)
    add_bowed_cluster(base, [77.782, 155.563, 311.127, 622.254], [0.025, 0.032, 0.024, 0.012], 0, 8, -0.18)
    add_shimmer(base, [1244.508, 1866.762, 2489.016], [0.012, 0.009, 0.006], 0, 7)
    for t in [8, 31, 66, 94]:
        add_bell(base, [622.254, 1244.508, 2489.016, 3733.524], t, 0.055, random.uniform(-0.7, 0.7))
    write_wav(OUT / "01_wind_eflat_stem.wav", base, 0.78)

    d = empty()
    add_bowed_cluster(d, [73.416, 146.832, 293.665, 587.33], [0.021, 0.023, 0.018, 0.01], 0, 5, 0.22)
    add_shimmer(d, [1174.66, 1761.99, 2349.32], [0.011, 0.008, 0.0055], 0, 5)
    for t in [4, 28, 58, 83]:
        add_bell(d, [587.33, 1174.66, 2349.32, 3523.98], t, 0.045, random.uniform(-0.75, 0.75))
    write_wav(OUT / "02_d_natural_only_stem.wav", d, 0.62)

    b = empty()
    add_bowed_cluster(b, [58.27, 116.541, 233.082, 466.164], [0.016, 0.018, 0.014, 0.008], 0, 5, -0.28)
    add_shimmer(b, [932.328, 1398.492, 2796.984], [0.008, 0.006, 0.004], 0, 5)
    add_bowed_cluster(b, [61.735, 123.471, 246.942, 493.883], [0.012, 0.014, 0.011, 0.006], 3, 5, 0.32)
    add_shimmer(b, [987.767, 1481.65, 2963.3], [0.006, 0.0045, 0.003], 3, 5)
    for t in [6, 37, 76]:
        add_bell(b, [466.164, 932.328, 1864.656, 2796.984], t, 0.04, random.uniform(-0.75, 0.75))
        add_bell(b, [493.883, 987.767, 1975.533, 2963.3], t + 3, 0.032, random.uniform(-0.75, 0.75))
    write_wav(OUT / "03_bflat_bnatural_stem.wav", b, 0.58)


if __name__ == "__main__":
    render()
