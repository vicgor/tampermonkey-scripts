import { describe, it, expect } from 'vitest';
import { parseAmount } from '../../scripts/agis-protocol-income-fill.user.js';

// normalizeText больше не экспортируется этим файлом — теперь из lib/agis-core.js,
// тестируется один раз в test/lib/agis-core.test.js (см. ROADMAP.md).

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
