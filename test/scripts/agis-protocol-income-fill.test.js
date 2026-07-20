import { describe, it, expect } from 'vitest';
import { normalizeText, parseAmount } from '../../scripts/agis-protocol-income-fill.user.js';

const NBSP = '\u00a0';

describe('normalizeText', () => {
  it('схлопывает повторяющиеся пробелы/табы и обрезает края', () => {
    expect(normalizeText('a   b\tc')).toBe('a b c');
  });

  it('заменяет nbsp на обычный пробел', () => {
    expect(normalizeText(`a${NBSP}b`)).toBe('a b');
  });

  it('пустой/отсутствующий ввод даёт пустую строку', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('parseAmount', () => {
  it('извлекает сумму с разделителем тысяч и десятичной точкой', () => {
    expect(parseAmount('Сумма: 1 234.56 руб')).toBe('1234.56');
  });

  it('извлекает отрицательную сумму с десятичной запятой', () => {
    expect(parseAmount('Сумма: -50,25')).toBe('-50.25');
  });

  it('возвращает пустую строку, если числа нет', () => {
    expect(parseAmount('нет чисел')).toBe('');
  });
});
