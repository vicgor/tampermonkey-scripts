import { describe, it, expect } from 'vitest';
import { extractTotal, resolveGateway, normalizeDate } from '../../scripts/agis-duplicate-income.user.js';

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

describe('resolveGateway', () => {
  it('находит шлюз по латинскому ключу независимо от регистра', () => {
    expect(resolveGateway('TINKOFF')).toBe('Tinkoff');
    expect(resolveGateway('Tinkoff')).toBe('Tinkoff');
  });

  it('находит шлюз по русскому ключу', () => {
    expect(resolveGateway('Евроальянс')).toBe('Евроальянс');
    expect(resolveGateway('Альфа-Банк')).toBe('Альфа-Банк');
  });

  it('находит шлюз по mi_-префиксному ключу', () => {
    expect(resolveGateway('mi_tinkoff')).toBe('Tinkoff');
  });

  it('finstar (латиницей от AGIS) резолвится в СИАБ-Банк', () => {
    expect(resolveGateway('finstar')).toBe('СИАБ-Банк');
  });

  it('неизвестный шлюз возвращает исходную строку как есть', () => {
    expect(resolveGateway('SomeRandomGateway')).toBe('SomeRandomGateway');
  });
});

describe('normalizeDate', () => {
  it('парсит дату с сокращением месяца с точкой', () => {
    expect(normalizeDate('14 мар. 2025 г., 14:37:00')).toBe('2025-03-14 14:37:00');
  });

  it('парсит дату с сокращением месяца без точки', () => {
    expect(normalizeDate('5 янв. 2024 г., 09:05:07')).toBe('2024-01-05 09:05:07');
  });

  it('парсит дату с полным названием месяца, без "г."', () => {
    expect(normalizeDate('14 марта 2025, 14:37:00')).toBe('2025-03-14 14:37:00');
  });

  it('дополняет однозначный час нулём', () => {
    expect(normalizeDate('5 июн 2024, 9:05:07')).toBe('2024-06-05 09:05:07');
  });

  it('возвращает пустую строку для пустого/отсутствующего ввода', () => {
    expect(normalizeDate('')).toBe('');
    expect(normalizeDate(null)).toBe('');
    expect(normalizeDate(undefined)).toBe('');
  });

  it('возвращает пустую строку для нераспознанного месяца или формата', () => {
    expect(normalizeDate('14 zzz 2025, 14:37:00')).toBe('');
    expect(normalizeDate('совсем не дата')).toBe('');
  });
});
