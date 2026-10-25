"""Genera una grabación sintética de un vuelo MMMX-MMGL (A320, 1 lectura por segundo).

Sirve para probar la máquina de fases y las métricas mientras no haya
grabaciones reales. El formato es el mismo que escribe LAM ACARS con
«Grabar vuelo»: JSON por línea, nombres en snake_case.

Uso: python3 packages/flight-engine/scripts/synthetic_flight.py
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

START = datetime(2026, 10, 25, 14, 0, 0, tzinfo=timezone.utc)
ORIGIN = (19.4363, -99.0721, 7316)
DEST = (20.5218, -103.3112, 5016)
OUT = Path(__file__).resolve().parent.parent / "fixtures" / "synthetic-mmmx-mmgl.jsonl"


def lerp(a, b, f):
    return a + (b - a) * max(0.0, min(1.0, f))


def main():
    rows = []
    alt = ORIGIN[2]
    gs = 0.0
    fuel = 6800.0
    lat, lon = ORIGIN[0], ORIGIN[1]
    for t in range(0, 3901):
        noise = math.sin(t / 7.0) * 30
        on_ground = True
        vs = 0.0
        engines = 0
        pushback = False
        backward = False
        brake = False
        gear = True
        flaps = 0.0
        g = 1.0 + math.sin(t / 3.0) * 0.01
        pitch = 0.0
        td_vs = None
        ground_elev = ORIGIN[2]

        if t < 120:
            brake = True
        elif t < 150:
            engines, brake = 1, True
        elif t < 200:
            engines, brake = 2, True
        if 150 <= t:
            engines = 2
        if 200 <= t < 260:
            pushback, backward, gs = True, True, 3.0
        elif 260 <= t < 300:
            gs = 0.0
        elif 300 <= t < 600:
            gs = 15.0 + math.sin(t / 11.0) * 3
            flaps = 0.25
        elif 600 <= t < 640:
            gs = lerp(15, 150, (t - 600) / 30)
            flaps = 0.25
        if t >= 640 and t < 3440:
            on_ground = False

        if not on_ground:
            frac = (t - 640) / (3440 - 640)
            lat = lerp(ORIGIN[0], DEST[0], frac)
            lon = lerp(ORIGIN[1], DEST[1], frac)
            if t < 1280:
                vs = 2500 + noise
                alt = min(34000, ORIGIN[2] + (t - 640) / 60 * 2500)
                gs = lerp(150, 450, (t - 640) / 640)
                pitch = 12.0
                gear = t < 650
                flaps = 0.25 if t < 700 else 0.0
            elif t < 2400:
                vs = noise
                alt = 34000 + noise / 10
                gs = 455 + noise / 10
                pitch = 2.5
                gear = False
            elif t < 3180:
                vs = -2000 + noise
                alt = 34000 - (t - 2400) / 60 * 2000
                gs = lerp(450, 250, (t - 2400) / 780)
                pitch = 0.5
                gear = False
            else:
                gear = True
                flaps = 0.75 if t > 3250 else 0.5
                pitch = 3.0
                agl_start = 34000 - 780 / 60 * 2000 - DEST[2]
                if t < 3425:
                    vs = -700
                    alt = DEST[2] + agl_start - (t - 3180) / 60 * 700
                else:
                    vs = -150
                    alt = max(DEST[2] + 1, DEST[2] + 15 - (t - 3425))
                gs = lerp(250, 140, (t - 3180) / 260)
            ground_elev = ORIGIN[2] if frac < 0.5 else DEST[2]
        else:
            if t >= 3440:
                lat, lon = DEST[0] + (t - 3440) * 0.00002, DEST[1]
                alt = DEST[2]
                ground_elev = DEST[2]
                flaps = 0.75 if t < 3480 else 0.0
                td_vs = -152.4
                if t < 3470:
                    gs = lerp(140, 25, (t - 3440) / 29)
                elif t < 3800:
                    gs = 15.0 + math.sin(t / 9.0) * 3
                else:
                    gs = 0.0
                if t >= 3810:
                    brake = True
                if t >= 3830:
                    engines = 1
                if t >= 3840:
                    engines = 0
                if 3440 <= t <= 3442:
                    g = 1.25 if t == 3441 else 1.12
                    pitch = 4.2
            else:
                alt = ORIGIN[2]

        fuel -= 0.15 if engines else 0
        rows.append({
            "time": (START + timedelta(seconds=t)).isoformat().replace("+00:00", "Z"),
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "altitude_ft": round(alt, 1),
            "agl_ft": round(max(0.0, alt - ground_elev), 1) if not on_ground else 0.0,
            "ias_kt": round(gs * 0.62, 1) if not on_ground and t > 700 and t < 3180 else round(gs, 1),
            "tas_kt": round(gs, 1),
            "gs_kt": round(gs, 1),
            "heading_deg": 290.0,
            "vs_fpm": round(vs, 1),
            "on_ground": on_ground,
            "engines_running": engines,
            "engine_count": 2,
            "pushback_active": pushback,
            "moving_backward": backward,
            "parking_brake": brake,
            "gear_down": gear,
            "flaps_ratio": flaps,
            "fuel_total_kg": round(fuel, 1),
            "g_force": round(g, 3),
            "pitch_deg": pitch,
            "bank_deg": 0.0,
            "touchdown_vs_fpm": td_vs,
            "touchdown_pitch_deg": 4.2 if td_vs else None,
            "touchdown_bank_deg": 0.6 if td_vs else None,
            "paused": False,
            "slew": False,
            "overspeed": False,
            "stall": False,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, separators=(",", ":")) + "\n")
    print(f"{len(rows)} lecturas en {OUT}")


if __name__ == "__main__":
    main()
