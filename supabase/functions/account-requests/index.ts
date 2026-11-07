// Aprueba o rechaza solicitudes de cuenta de piloto e invita por correo.
//
// - Los permisos los revisa la base con el token de quien llama
//   (approve_account_request, reject_account_request y
//   create_account_invitation exigen superadministrador).
// - Solo la invitación usa la clave secreta: auth.admin.inviteUserByEmail manda
//   el correo de Supabase Auth con el enlace para elegir contraseña. El
//   disparador before_auth_user_created deja crear al usuario porque su
//   solicitud ya está aprobada.
// - «resend»: la invitación vence; se vuelve a mandar con la misma solicitud.
// - «revoke» / «restore»: set_account_access suspende o reactiva la cuenta y
//   aquí se bloquea o desbloquea el inicio de sesión en Supabase Auth.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SITE_URL = Deno.env.get('LAM_SITE_URL') ?? 'https://inavae.github.io/lam-virtual-acars/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function fail(code: string, error: string, status: number): Response {
  return json({ code, error }, status);
}

function key(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS', fallback: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(name) ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    // Formato anterior de claves.
  }
  return Deno.env.get(fallback) ?? '';
}

type Body = { action?: unknown; request_id?: unknown; user_id?: unknown; note?: unknown; email?: unknown; display_name?: unknown };

// Bloqueo de Supabase Auth al revocar: unos 100 años; «none» lo quita.
const BAN_FOREVER = '876000h';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method', 'Usa POST', 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return fail('auth', 'Inicia sesión', 401);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const asCaller = createClient(url, key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoError } = await asCaller.auth.getUser(authorization.slice('Bearer '.length));
  if (whoError || !who.user) return fail('auth', 'La sesión no es válida', 401);

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Cuerpo inválido.
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const requestId = typeof body.request_id === 'string' && UUID.test(body.request_id) ? body.request_id : null;

  // Rechazar: solo la base.
  if (action === 'reject') {
    if (!requestId) return fail('bad_request', 'Falta la solicitud', 400);
    const { error } = await asCaller.rpc('reject_account_request', {
      p_request_id: requestId,
      p_note: typeof body.note === 'string' ? body.note : null,
    });
    if (error) return fail('db', error.message, error.code === '42501' ? 403 : 409);
    return json({ ok: true });
  }

  // Revocar o restaurar el acceso de una cuenta.
  if (action === 'revoke' || action === 'restore') {
    const userId = typeof body.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : null;
    if (!userId) return fail('bad_request', 'Falta la cuenta', 400);
    if (userId === who.user.id) return fail('self', 'No puedes revocar tu propio acceso', 409);
    const active = action === 'restore';
    const { data, error } = await asCaller.rpc('set_account_access', {
      p_user_id: userId,
      p_active: active,
      p_note: typeof body.note === 'string' ? body.note : null,
    });
    if (error) return fail('db', error.message, error.code === '42501' ? 403 : 409);
    const admin = createClient(url, key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : BAN_FOREVER });
    if (banError) {
      return fail(
        'ban',
        active
          ? `La cuenta quedó activa, pero no se pudo desbloquear el inicio de sesión: ${banError.message}. Intenta de nuevo.`
          : `La cuenta quedó suspendida, pero no se pudo bloquear el inicio de sesión: ${banError.message}. Intenta de nuevo.`,
        502,
      );
    }
    return json({ ok: true, ...(data as Record<string, unknown>) });
  }

  // Aprobar, reenviar o invitar directamente: la base aprueba y aquí se manda el correo.
  let approved: { id: string; email: string; display_name: string } | null = null;
  if (action === 'approve' || action === 'resend') {
    if (!requestId) return fail('bad_request', 'Falta la solicitud', 400);
    const { data, error } = await asCaller.rpc('approve_account_request', { p_request_id: requestId });
    if (error) return fail('db', error.message, error.code === '42501' ? 403 : 409);
    approved = data as typeof approved;
  } else if (action === 'invite') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (!email || name.length < 2) return fail('bad_request', 'Escribe el correo y el nombre del piloto', 400);
    const { data, error } = await asCaller.rpc('create_account_invitation', { p_email: email, p_display_name: name });
    if (error) return fail('db', error.message, error.code === '42501' ? 403 : 409);
    approved = { id: data as string, email, display_name: name };
  } else {
    return fail('bad_request', 'Acción desconocida', 400);
  }
  if (!approved) return fail('db', 'No se pudo aprobar la solicitud', 500);

  const admin = createClient(url, key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(approved.email, {
    data: { display_name: approved.display_name },
    redirectTo: `${SITE_URL}auth/callback`,
  });
  await admin.rpc('record_account_invitation', { p_request_id: approved.id, p_error: inviteError ? inviteError.message : null });
  if (inviteError) {
    return fail('invite', `La solicitud quedó aprobada, pero el correo no se pudo mandar: ${inviteError.message}. Intenta «Reenviar invitación».`, 502);
  }
  return json({ ok: true, email: approved.email });
});
