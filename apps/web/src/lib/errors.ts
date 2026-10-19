/** Mensaje claro para el usuario a partir de errores de Supabase o de red. */
export function describeError(error: unknown): string {
  const raw = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';

  if (/Invalid login credentials/i.test(raw)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(raw)) return 'Confirma tu correo con el enlace que te enviamos antes de iniciar sesión.';
  if (/User already registered/i.test(raw)) return 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.';
  if (/rate limit/i.test(raw) || code === '429') return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if (/same.*password|different from the old/i.test(raw)) return 'La nueva contraseña debe ser distinta a la actual.';
  if (/Failed to fetch|NetworkError/i.test(raw)) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  if (code === '42501') return 'No tienes permiso para hacer esto.';
  if (code === '23514' && /principal/i.test(raw)) return 'Solo puedes elegir como principal una aerolínea donde tu membresía esté activa.';
  if (code === '23505') return 'Ese registro ya existe.';
  return raw || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}
