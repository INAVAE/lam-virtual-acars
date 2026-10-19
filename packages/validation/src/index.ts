import { z } from 'zod';

/**
 * Esquemas de validación compartidos entre la web y las Edge Functions.
 * Las reglas reflejan las restricciones de la base de datos; la base de
 * datos sigue siendo la última línea de defensa.
 */

export const PASSWORD_MIN_LENGTH = 8;

const email = z
  .string({ required_error: 'Escribe tu correo' })
  .trim()
  .min(1, 'Escribe tu correo')
  .email('Escribe un correo válido');

const password = z
  .string({ required_error: 'Escribe una contraseña' })
  .min(PASSWORD_MIN_LENGTH, `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(72, 'Usa como máximo 72 caracteres')
  .regex(/[A-Za-z]/, 'Incluye al menos una letra')
  .regex(/[0-9]/, 'Incluye al menos un número');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Usa al menos 2 caracteres')
  .max(80, 'Usa como máximo 80 caracteres');

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Escribe tu contraseña'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    displayName: displayNameSchema,
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const passwordResetRequestSchema = z.object({ email });
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const newPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  });
export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

/** Convierte cadenas vacías de formularios en null. */
const optionalText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable());

export const profileUpdateSchema = z.object({
  displayName: displayNameSchema,
  countryCode: optionalText(
    z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Elige un país de la lista'),
  ),
  simbriefUsername: optionalText(
    z.string().trim().max(64, 'Usa como máximo 64 caracteres'),
  ),
  primaryAirlineId: optionalText(z.string().uuid('Elige una aerolínea de la lista')),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const icaoAirlineCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'El código ICAO de aerolínea tiene 3 letras');

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Usa un color en formato #RRGGBB');
