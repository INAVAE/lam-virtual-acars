import { describe, expect, it } from 'vitest';
import { legBlock, normalizeTourCode, TOUR_CODE_PATTERN, tourProgress, tourWindow, type LegState, type MyLeg } from './tours';

const legs = (...states: LegState[]): MyLeg[] =>
  states.map((state, i) => ({ leg_id: `l${i + 1}`, leg_number: i + 1, state, flight_id: null, pirep_id: null, pirep_status: null, attempts: 0 }));
const ordered = { ordered_legs: true, allow_unreviewed_progress: true, max_unreviewed_legs: 2 };

describe('legBlock', () => {
  it('en orden, solo deja el siguiente leg sin volar', () => {
    const l = legs('accepted', 'open', 'open');
    expect(legBlock(ordered, l, 1)).toBe('done');
    expect(legBlock(ordered, l, 2)).toBeNull();
    expect(legBlock(ordered, l, 3)).toBe('out_of_order');
  });

  it('un leg en revisión cuenta como volado, hasta el máximo sin revisar', () => {
    expect(legBlock(ordered, legs('in_review', 'open', 'open'), 2)).toBeNull();
    expect(legBlock(ordered, legs('in_review', 'in_review', 'open'), 3)).toBe('too_many_unreviewed');
    expect(legBlock({ ...ordered, allow_unreviewed_progress: false }, legs('in_review', 'open'), 2)).toBe('previous_unreviewed');
  });

  it('un leg rechazado se repite y frena a los siguientes', () => {
    const l = legs('repeat', 'accepted', 'open');
    expect(legBlock(ordered, l, 1)).toBeNull();
    expect(legBlock(ordered, l, 3)).toBe('out_of_order');
  });

  it('un vuelo del tour a la vez; en cualquier orden no hay que esperar', () => {
    expect(legBlock(ordered, legs('booked', 'open'), 2)).toBe('tour_flight_active');
    expect(legBlock(ordered, legs('booked', 'open'), 1)).toBe('booked');
    expect(legBlock({ ...ordered, ordered_legs: false }, legs('open', 'open', 'open'), 3)).toBeNull();
  });
});

describe('tourProgress', () => {
  it('cuenta aceptados y volados', () => {
    expect(tourProgress(legs('accepted', 'in_review', 'repeat', 'open'))).toEqual({ accepted: 1, flown: 2, total: 4 });
  });
});

describe('códigos y vigencia', () => {
  it('normaliza el código del tour', () => {
    expect(normalizeTourCode(' tmx 01 ')).toBe('TMX-01');
    expect(TOUR_CODE_PATTERN.test('TMX-01')).toBe(true);
    expect(TOUR_CODE_PATTERN.test('T')).toBe(false);
  });

  it('dice si el tour está por empezar, vigente o terminado', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(tourWindow({ starts_on: '2026-12-01', ends_on: null }, now)).toBe('upcoming');
    expect(tourWindow({ starts_on: null, ends_on: '2026-11-01' }, now)).toBe('ended');
    expect(tourWindow({ starts_on: '2026-11-10', ends_on: '2026-11-10' }, now)).toBe('open');
  });
});
