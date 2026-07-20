import { describe, it, expect } from 'vitest';
import { ruMonthNumber } from '../../lib/agis-core.js';

describe('ruMonthNumber', () => {
  it('распознаёт полное название месяца', () => {
    expect(ruMonthNumber('январь')).toBe('01');
    expect(ruMonthNumber('декабря')).toBe('12');
  });

  it('распознаёт сокращения с точкой и без', () => {
    expect(ruMonthNumber('янв.')).toBe('01');
    expect(ruMonthNumber('янв')).toBe('01');
  });

  it('регистронезависим и обрезает пробелы', () => {
    expect(ruMonthNumber('ЯНВАРЬ')).toBe('01');
    expect(ruMonthNumber('  март  ')).toBe('03');
  });

  it('покрывает все 12 месяцев', () => {
    expect(ruMonthNumber('январь')).toBe('01');
    expect(ruMonthNumber('фев')).toBe('02');
    expect(ruMonthNumber('март')).toBe('03');
    expect(ruMonthNumber('апрель')).toBe('04');
    expect(ruMonthNumber('май')).toBe('05');
    expect(ruMonthNumber('июнь')).toBe('06');
    expect(ruMonthNumber('июль')).toBe('07');
    expect(ruMonthNumber('август')).toBe('08');
    expect(ruMonthNumber('сентябрь')).toBe('09');
    expect(ruMonthNumber('октябрь')).toBe('10');
    expect(ruMonthNumber('ноябрь')).toBe('11');
    expect(ruMonthNumber('декабрь')).toBe('12');
  });

  it('возвращает null для нераспознанного/пустого ввода', () => {
    expect(ruMonthNumber('foo')).toBeNull();
    expect(ruMonthNumber('')).toBeNull();
    expect(ruMonthNumber(null)).toBeNull();
    expect(ruMonthNumber(undefined)).toBeNull();
  });
});
