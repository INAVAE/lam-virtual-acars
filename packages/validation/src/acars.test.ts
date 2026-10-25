import { describe, expect, it } from 'vitest';
import events from '../../../docs/integrations/acars-v1-examples/events.request.json';
import linkPoll from '../../../docs/integrations/acars-v1-examples/link-poll.request.json';
import linkStart from '../../../docs/integrations/acars-v1-examples/link-start.request.json';
import position from '../../../docs/integrations/acars-v1-examples/position.request.json';
import sessionEnd from '../../../docs/integrations/acars-v1-examples/session-end.request.json';
import sessionStart from '../../../docs/integrations/acars-v1-examples/session-start.request.json';
import trackBatch from '../../../docs/integrations/acars-v1-examples/track-batch.request.json';
import {
  eventsRequest,
  linkPollRequest,
  linkStartRequest,
  positionRequest,
  sessionEndRequest,
  sessionStartRequest,
  trackBatchRequest,
} from './acars';

describe('contrato ACARS v1: ejemplos documentados', () => {
  it.each([
    ['link-start', linkStartRequest, linkStart],
    ['link-poll', linkPollRequest, linkPoll],
    ['session-start', sessionStartRequest, sessionStart],
    ['position', positionRequest, position],
    ['track-batch', trackBatchRequest, trackBatch],
    ['events', eventsRequest, events],
    ['session-end', sessionEndRequest, sessionEnd],
  ] as const)('%s es válido', (_name, schema, example) => {
    const result = schema.safeParse(example);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('normaliza el código de vinculación', () => {
    expect(linkPollRequest.parse(linkPoll).code).toBe('K7QF2M9P');
  });

  it('rechaza fases y eventos desconocidos', () => {
    expect(positionRequest.safeParse({ ...position, position: { ...position.position, phase: 'boarding' } }).success).toBe(false);
    const bad = { ...events, events: [{ ...events.events[0], type: 'teleport' }] };
    expect(eventsRequest.safeParse(bad).success).toBe(false);
  });

  it('limita el tamaño de los lotes', () => {
    const points = Array.from({ length: 601 }, (_, i) => ({ ...trackBatch.points[0], seq: i }));
    expect(trackBatchRequest.safeParse({ ...trackBatch, points }).success).toBe(false);
  });
});
