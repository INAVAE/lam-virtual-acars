import { describe, expect, it } from 'vitest';
import {
  icaoAirlineCodeSchema,
  newPasswordSchema,
  profileUpdateSchema,
  signUpSchema,
} from './index';

describe('signUpSchema', () => {
  const valid = {
    displayName: 'Capitana Ruiz',
    email: 'piloto@example.com',
    password: 'cabina2024',
    confirmPassword: 'cabina2024',
  };

  it('acepta un registro válido', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it('rechaza contraseñas distintas', () => {
    const result = signUpSchema.safeParse({ ...valid, confirmPassword: 'otra2024' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('exige letras y números en la contraseña', () => {
    expect(signUpSchema.safeParse({ ...valid, password: '12345678', confirmPassword: '12345678' }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: 'abcdefgh', confirmPassword: 'abcdefgh' }).success).toBe(false);
  });

  it('rechaza un nombre de un solo carácter', () => {
    expect(signUpSchema.safeParse({ ...valid, displayName: 'A' }).success).toBe(false);
  });
});

describe('newPasswordSchema', () => {
  it('rechaza contraseñas cortas', () => {
    expect(newPasswordSchema.safeParse({ password: 'ab1', confirmPassword: 'ab1' }).success).toBe(false);
  });
});

describe('profileUpdateSchema', () => {
  it('convierte campos vacíos en null', () => {
    const result = profileUpdateSchema.parse({
      displayName: 'Piloto LAM',
      countryCode: '',
      simbriefUsername: '  ',
      primaryAirlineId: '',
    });
    expect(result).toEqual({
      displayName: 'Piloto LAM',
      countryCode: null,
      simbriefUsername: null,
      primaryAirlineId: null,
    });
  });

  it('normaliza el código de país a mayúsculas', () => {
    const result = profileUpdateSchema.parse({
      displayName: 'Piloto LAM',
      countryCode: 'mx',
      simbriefUsername: null,
      primaryAirlineId: null,
    });
    expect(result.countryCode).toBe('MX');
  });

  it('rechaza un id de aerolínea inválido', () => {
    const result = profileUpdateSchema.safeParse({
      displayName: 'Piloto LAM',
      countryCode: null,
      simbriefUsername: null,
      primaryAirlineId: 'alas-del-sur',
    });
    expect(result.success).toBe(false);
  });
});

describe('icaoAirlineCodeSchema', () => {
  it('acepta tres letras y las pasa a mayúsculas', () => {
    expect(icaoAirlineCodeSchema.parse('ads')).toBe('ADS');
  });

  it('rechaza códigos con números o longitud distinta', () => {
    expect(icaoAirlineCodeSchema.safeParse('AD1').success).toBe(false);
    expect(icaoAirlineCodeSchema.safeParse('ADSX').success).toBe(false);
  });
});
