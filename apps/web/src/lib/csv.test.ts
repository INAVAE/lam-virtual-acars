import { describe, expect, it } from 'vitest';
import { csvCell, csvToObjects, parseCsv } from './csv';

describe('parseCsv', () => {
  it('lee campos con comillas, comas y saltos de línea', () => {
    expect(parseCsv('a,b\n"1,5","dos\nlíneas"\n')).toEqual([
      ['a', 'b'],
      ['1,5', 'dos\nlíneas'],
    ]);
  });

  it('admite comillas escapadas y CRLF', () => {
    expect(parseCsv('x\r\n"di ""hola"""\r\n')).toEqual([['x'], ['di "hola"']]);
  });

  it('detecta punto y coma como separador', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ignora filas vacías y el BOM', () => {
    expect(parseCsv('﻿a\n\n1\n')).toEqual([['a'], ['1']]);
  });
});

describe('csvToObjects', () => {
  it('usa los encabezados en minúsculas como claves', () => {
    expect(csvToObjects('Flight_Number,Origin\n100,MMMX')).toEqual([{ flight_number: '100', origin: 'MMMX' }]);
  });
});

describe('csvCell', () => {
  it('pone entre comillas los valores con separadores', () => {
    expect(csvCell('B738|A20N')).toBe('B738|A20N');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });
});
