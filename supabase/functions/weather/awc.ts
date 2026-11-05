// Conversión de las respuestas del Aviation Weather Center (NOAA) a la forma que
// guarda la caché y consume la web. Sin dependencias de Deno: se prueba con Node.

export type Obj = Record<string, unknown>;

export function obj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}

export function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

export function str(value: unknown, max = 600): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/** Dirección del viento: grados o "VRB". */
function wdir(value: unknown): number | string | null {
  if (typeof value === 'string' && value.trim().toUpperCase() === 'VRB') return 'VRB';
  return num(value);
}

/** Visibilidad en millas terrestres: número o "10+". */
function visib(value: unknown): number | string | null {
  if (typeof value === 'string' && /^\d+(\.\d+)?\+$/.test(value.trim())) return value.trim();
  return num(value);
}

function clouds(value: unknown): Obj[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((c) => {
    const o = obj(c);
    return { cover: str(o.cover, 8), base: num(o.base), ...(str(o.type, 8) ? { type: str(o.type, 8) } : {}) };
  });
}

function epochIso(value: unknown): string | null {
  const n = num(value);
  return n && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** "2026-11-04 01:00:00" (UTC) o ISO → ISO. */
function timeIso(value: unknown): string | null {
  const s = str(value, 40);
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function pickMetar(m: Obj): Obj {
  return {
    raw: str(m.rawOb, 600),
    type: str(m.metarType, 10),
    observed_at: epochIso(m.obsTime) ?? timeIso(m.reportTime),
    temp_c: num(m.temp),
    dewpoint_c: num(m.dewp),
    wind_dir: wdir(m.wdir),
    wind_kt: num(m.wspd),
    gust_kt: num(m.wgst),
    visibility_sm: visib(m.visib),
    altimeter_hpa: num(m.altim),
    weather: str(m.wxString, 80),
    vertical_visibility_ft: num(m.vertVis),
    clouds: clouds(m.clouds),
    flight_category: str(m.fltCat, 5),
  };
}

export function pickTaf(t: Obj): Obj {
  const fcsts = Array.isArray(t.fcsts) ? t.fcsts : [];
  return {
    raw: str(t.rawTAF, 3000),
    issued_at: timeIso(t.issueTime),
    valid_from: epochIso(t.validTimeFrom),
    valid_to: epochIso(t.validTimeTo),
    periods: fcsts.slice(0, 20).map((f) => {
      const p = obj(f);
      return {
        from: epochIso(p.timeFrom),
        to: epochIso(p.timeTo),
        change: str(p.fcstChange, 10),
        probability: num(p.probability),
        wind_dir: wdir(p.wdir),
        wind_kt: num(p.wspd),
        gust_kt: num(p.wgst),
        visibility_sm: visib(p.visib),
        weather: str(p.wxString, 80),
        vertical_visibility_ft: num(p.vertVis),
        clouds: clouds(p.clouds),
      };
    }),
  };
}

/** El más reciente por estación (por si NOAA devuelve varios). */
export function latestBy(rows: Obj[], key: (r: Obj) => number): Map<string, Obj> {
  const map = new Map<string, Obj>();
  for (const r of rows) {
    const icao = str(r.icaoId, 4)?.toUpperCase();
    if (!icao) continue;
    const current = map.get(icao);
    if (!current || key(r) > key(current)) map.set(icao, r);
  }
  return map;
}

export function isStale(fetchedAt: string | null, ttl: number, now: number): boolean {
  return !fetchedAt || now - Date.parse(fetchedAt) > ttl;
}
