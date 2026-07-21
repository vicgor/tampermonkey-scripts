import { describe, it, expect } from 'vitest';
import { ruMonthNumber, normalizeText, cellText } from '../../lib/agis-core.js';

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

// Волна 5: перенесены из agis-loan-info-navbar.user.js/agis-protocol-income-fill.user.js
// (обе версии были буквально идентичны) и заинлайненного варианта в
// agis-duplicate-income.user.js — см. ROADMAP.md.
describe('normalizeText', () => {
  it('схлопывает повторяющиеся пробелы/табы/переводы строк и обрезает края', () => {
    expect(normalizeText('a   b\tc\n\nd')).toBe('a b c d');
    expect(normalizeText('  x  ')).toBe('x');
  });

  it('nbsp (\\u00a0) тоже схлопывается — \\s в JS уже покрывает его', () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(normalizeText(`a${nbsp}b`)).toBe('a b');
  });

  it('пустой/отсутствующий ввод даёт пустую строку', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  it('приводит нестроковые значения через String()', () => {
    expect(normalizeText(42)).toBe('42');
  });
});

describe('cellText', () => {
  it('нормализует textContent переданного узла', () => {
    expect(cellText({ textContent: '  x   y  ' })).toBe('x y');
  });

  it('null/undefined даёт пустую строку, не исключение', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });
});
