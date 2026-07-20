import { describe, it, expect } from 'vitest';
import { extractTotal } from '../../scripts/agis-duplicate-income.user.js';

describe('extractTotal', () => {
  it('извлекает сумму с десятичной точкой', () => {
    expect(extractTotal('Итого: 1234.56')).toBe('1234.56');
  });

  it('извлекает сумму в формате "тысячи через точку, дробь через запятую"', () => {
    expect(extractTotal('Итого: 1.234,56')).toBe('1234.56');
  });

  it('работает без двоеточия после "Итого"', () => {
    expect(extractTotal('Итого 5000')).toBe('5000');
  });

  it('убирает пробелы-разделители тысяч (включая nbsp)', () => {
    expect(extractTotal('Итого: 1 000,00')).toBe('1000.00');
  });

  it('возвращает пустую строку, если "Итого" не найдено', () => {
    expect(extractTotal('нет итого тут')).toBe('');
  });

  it('регистронезависимо к "Итого"', () => {
    expect(extractTotal('итого: 999')).toBe('999');
  });
});
