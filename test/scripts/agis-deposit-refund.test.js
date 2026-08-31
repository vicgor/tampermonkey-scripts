import { describe, it, expect } from 'vitest';

const {
  parseRoute,
  parseMoneyToKopecks,
  formatRubles,
  formatAmountForInput,
  normalizeComparable,
  extractDepositFromText,
  scoreFieldDescription,
  isPayloadUsable,
} = require('../../scripts/agis-deposit-refund.user.js');

describe('parseRoute', () => {
  it('распознаёт карточку займа', () => {
    expect(parseRoute('/admin/agis2/core/loan/123456/edit')).toEqual({ loanId: '123456', page: 'edit' });
  });

  it('распознаёт форму создания транзакции (с завершающим слэшем тоже)', () => {
    expect(parseRoute('/admin/agis2/core/loan/77/loantransaction/create')).toEqual({ loanId: '77', page: 'create' });
    expect(parseRoute('/admin/agis2/core/loan/77/loantransaction/create/')).toEqual({ loanId: '77', page: 'create' });
  });

  it('возвращает null на посторонних путях займа', () => {
    expect(parseRoute('/admin/agis2/core/loan/123/income/list')).toBeNull();
    expect(parseRoute('/admin/agis2/core/loan-extended/123/edit')).toBeNull();
    expect(parseRoute('/admin/agis2/core/loan/abc/edit')).toBeNull();
    expect(parseRoute('')).toBeNull();
    expect(parseRoute(null)).toBeNull();
  });
});

describe('parseMoneyToKopecks', () => {
  it('разбирает суммы AGIS с пробелами-разделителями и запятой', () => {
    expect(parseMoneyToKopecks('1 234,56 ₽')).toBe(123456);
    expect(parseMoneyToKopecks('1\u00a0234,56 ₽')).toBe(123456);
    expect(parseMoneyToKopecks('1\u202f234.56')).toBe(123456);
  });

  it('держит копейки целыми (без float-погрешности)', () => {
    expect(parseMoneyToKopecks('1234.56')).toBe(123456);
    expect(parseMoneyToKopecks('0,07')).toBe(7);
    expect(parseMoneyToKopecks('8,29')).toBe(829);
  });

  it('понимает нули и отрицательные значения', () => {
    expect(parseMoneyToKopecks('0,00 ₽')).toBe(0);
    expect(parseMoneyToKopecks('-500,00 ₽')).toBe(-50000);
  });

  it('возвращает null, если числа нет', () => {
    expect(parseMoneyToKopecks('нет данных')).toBeNull();
    expect(parseMoneyToKopecks('')).toBeNull();
    expect(parseMoneyToKopecks(null)).toBeNull();
  });
});

describe('formatRubles / formatAmountForInput', () => {
  it('форматирует рубли для отображения', () => {
    const formatted = formatRubles(123456);
    expect(formatted).toMatch(/1.234,56/);
    expect(formatted).toContain('₽');
  });

  it('форматирует сумму для input — точка и ровно две цифры', () => {
    expect(formatAmountForInput(123456)).toBe('1234.56');
    expect(formatAmountForInput(7)).toBe('0.07');
    expect(formatAmountForInput(100000)).toBe('1000.00');
  });
});

describe('normalizeComparable', () => {
  it('сжимает пробелы, режет края и приводит к нижнему регистру', () => {
    expect(normalizeComparable('  Тип\u00a0 ТРАНЗАКЦИИ \n')).toBe('тип транзакции');
    expect(normalizeComparable(null)).toBe('');
  });
});

describe('extractDepositFromText', () => {
  it('находит «ДС на счету» в тексте страницы', () => {
    const result = extractDepositFromText('Займ #1 Статус: Активен ДС на счету: 1 234,56 ₽ Дата возврата: 01.09.2026');
    expect(result.kopecks).toBe(123456);
    expect(result.sourceText).toBe('ДС на счету: 1 234,56 ₽');
  });

  it('терпит отсутствие двоеточия и nbsp внутри числа', () => {
    expect(extractDepositFromText('ДС на счету 8\u00a0200,00 ₽').kopecks).toBe(820000);
  });

  it('распознаёт нулевой и отрицательный депозит (кнопка потом блокируется)', () => {
    expect(extractDepositFromText('ДС на счету: 0,00 ₽').kopecks).toBe(0);
    expect(extractDepositFromText('ДС на счету: -300,00 ₽').kopecks).toBe(-30000);
  });

  it('возвращает null, если метки нет', () => {
    expect(extractDepositFromText('Остаток задолженности: 1 000,00 ₽')).toBeNull();
    expect(extractDepositFromText('')).toBeNull();
  });
});

describe('scoreFieldDescription', () => {
  it('даёт по 10 за каждый совпавший паттерн', () => {
    expect(scoreFieldDescription('сумма транзакции amount', [/amount/iu, /сумм/iu])).toBe(20);
    expect(scoreFieldDescription('сумма', [/amount/iu, /сумм/iu])).toBe(10);
    expect(scoreFieldDescription('внешний id', [/amount/iu, /сумм/iu])).toBe(0);
  });
});

describe('isPayloadUsable', () => {
  const now = 1_700_000_000_000;
  const fresh = { loanId: '42', kopecks: 123456, createdAt: now - 60_000 };

  it('пропускает свежий payload того же займа', () => {
    expect(isPayloadUsable(fresh, '42', now)).toBe(true);
  });

  it('отбрасывает чужой заём, просрочку и неположительную сумму', () => {
    expect(isPayloadUsable(fresh, '43', now)).toBe(false);
    expect(isPayloadUsable({ ...fresh, createdAt: now - 16 * 60 * 1000 }, '42', now)).toBe(false);
    expect(isPayloadUsable({ ...fresh, kopecks: 0 }, '42', now)).toBe(false);
    expect(isPayloadUsable({ ...fresh, kopecks: -1 }, '42', now)).toBe(false);
  });

  it('отбрасывает мусор вместо payload', () => {
    expect(isPayloadUsable(null, '42', now)).toBe(false);
    expect(isPayloadUsable({ loanId: '42' }, '42', now)).toBe(false);
    expect(isPayloadUsable({ loanId: '42', kopecks: 100, createdAt: 'вчера' }, '42', now)).toBe(false);
  });
});
