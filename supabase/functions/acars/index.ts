// API ACARS v1 para LAM ACARS Connector.
//
// - Rutas: /acars/v1/... (ver docs/integrations/acars-api.md).
// - El conector se autentica con un token de dispositivo opaco (Bearer). Aquí
//   solo se calcula su hash; las funciones SQL acars_* validan dispositivo,
//   piloto, vuelo y límites, y escriben con idempotencia.
// - Usa la clave secreta del proyecto (variable de entorno de la Edge
//   Function), que nunca sale del servidor.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import type { ZodTypeAny, z } from 'zod';
import {
  ACARS_ERROR_STATUS,
  eventsRequest,
  linkPollRequest,
  linkStartRequest,
  positionRequest,
  sessionEndRequest,
  sessionStartRequest,
  trackBatchRequest,
} from './contract.ts';

const MAX_BODY_BYTES = 512 * 1024;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function errorResponse(error: ApiError): Response {
  const status = ACARS_ERROR_STATUS[error.code] ?? 400;
  const body: Record<string, unknown> = { code: error.code, message: error.message };
  if (error.details) body.details = error.details;
  return json({ error: body }, status);
}

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    // Formato anterior de claves.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  client ??= createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const b of buffer) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readBody<T extends ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) throw new ApiError('batch_too_large', 'El cuerpo de la solicitud es demasiado grande');
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new Error('too large');
    raw = JSON.parse(text);
  } catch {
    throw new ApiError('bad_request', 'El cuerpo debe ser JSON válido');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      'bad_request',
      'La solicitud no cumple el contrato ACARS v1',
      parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}

async function deviceTokenHash(req: Request): Promise<string> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^lamd_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError('invalid_token', 'Falta el token del dispositivo o no es válido');
  }
  return sha256Hex(token);
}

/** Llama a una función SQL acars_* y traduce su error (HINT) a ApiError. */
async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) {
    const code = error.hint && /^[a-z_]+$/.test(error.hint) ? error.hint : null;
    if (code) throw new ApiError(code, error.message);
    console.error(`${fn} falló`, error);
    throw new ApiError('server_error', 'Error del servidor; el conector reintentará');
  }
  return data as T;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('cf-connecting-ip') || null;
}

// -----------------------------------------------------------------------------
// Rutas
// -----------------------------------------------------------------------------
type Handler = (req: Request) => Promise<Response>;

const routes: Record<string, Handler> = {
  'GET /health': () => Promise.resolve(json({ ok: true, api: 'acars', version: 'v1', time: new Date().toISOString() })),

  'POST /link/start': async (req) => {
    const body = await readBody(req, linkStartRequest);
    const pollSecret = randomToken(32);
    const ip = clientIp(req);
    const data = await rpc<{ code: string; expires_at: string; poll_interval_s: number }>('acars_link_start', {
      p_device_name: body.device_name,
      p_app_version: body.app_version,
      p_poll_secret_hash: await sha256Hex(pollSecret),
      p_ip_hash: ip ? await sha256Hex(`lam-acars:${ip}`) : null,
    });
    return json({
      code: `${data.code.slice(0, 4)}-${data.code.slice(4)}`,
      poll_secret: pollSecret,
      expires_at: data.expires_at,
      poll_interval_s: data.poll_interval_s,
    });
  },

  'POST /link/poll': async (req) => {
    const body = await readBody(req, linkPollRequest);
    const token = `lamd_${randomToken(32)}`;
    const data = await rpc<{ status: string; device_id?: string; pilot?: unknown }>('acars_link_poll', {
      p_code: body.code,
      p_poll_secret_hash: await sha256Hex(body.poll_secret),
      p_token_hash: await sha256Hex(token),
      p_token_prefix: token.slice(0, 9),
    });
    if (data.status !== 'approved') return json({ status: 'pending' });
    // El token solo viaja esta vez; el servidor guarda únicamente su hash.
    return json({ status: 'approved', token, device_id: data.device_id, pilot: data.pilot });
  },

  'GET /me': async (req) => json(await rpc('acars_me', { p_token_hash: await deviceTokenHash(req) })),

  'POST /session/start': async (req) => {
    const tokenHash = await deviceTokenHash(req);
    const body = await readBody(req, sessionStartRequest);
    return json(
      await rpc('acars_session_start', {
        p_token_hash: tokenHash,
        p_flight_id: body.flight_id,
        p_sim_title: body.aircraft.title ?? null,
        p_sim_icao: body.aircraft.icao ?? null,
        p_sim_registration: body.aircraft.registration ?? null,
        p_client_version: body.client_version,
      }),
    );
  },

  'POST /position': async (req) => {
    const tokenHash = await deviceTokenHash(req);
    const body = await readBody(req, positionRequest);
    return json(await rpc('acars_position', { p_token_hash: tokenHash, p_session_id: body.session_id, p_position: body.position }));
  },

  'POST /track-batch': async (req) => {
    const tokenHash = await deviceTokenHash(req);
    const body = await readBody(req, trackBatchRequest);
    return json(await rpc('acars_track_batch', { p_token_hash: tokenHash, p_session_id: body.session_id, p_points: body.points }));
  },

  'POST /events': async (req) => {
    const tokenHash = await deviceTokenHash(req);
    const body = await readBody(req, eventsRequest);
    return json(await rpc('acars_events', { p_token_hash: tokenHash, p_session_id: body.session_id, p_events: body.events }));
  },

  'POST /session/end': async (req) => {
    const tokenHash = await deviceTokenHash(req);
    const body = await readBody(req, sessionEndRequest);
    const data = await rpc<Record<string, unknown>>('acars_session_end', {
      p_token_hash: tokenHash,
      p_session_id: body.session_id,
      p_reason: body.reason,
      p_latitude: body.latitude ?? null,
      p_longitude: body.longitude ?? null,
    });
    // La posición viva solo existe mientras el vuelo está en curso.
    const { error } = await db().from('flight_positions_live').delete().eq('session_id', body.session_id);
    if (error) console.error('No se pudo borrar la posición viva', error);
    return json(data);
  },
};
routes['POST /event'] = routes['POST /events']!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const match = path.match(/\/acars\/v1(\/.*)?$/);
  const route = match ? `${req.method} ${match[1] ?? '/'}` : '';
  const handler = routes[route];
  if (!handler) return errorResponse(new ApiError('not_found', `Ruta no encontrada: ${req.method} ${path}`));

  try {
    return await handler(req);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error('Error inesperado', error);
    return errorResponse(new ApiError('server_error', 'Error del servidor; el conector reintentará'));
  }
});
