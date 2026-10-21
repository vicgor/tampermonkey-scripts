import { describe, it, expect } from 'vitest';
import {
  parseParamLines,
  parseAmount,
  toFormDateTime,
  resolveIncomeTypeOption,
  parseTicketFromHash,
  buildComment,
} from '../../scripts/agis-task-item-income-fill.user.js';

describe('parseParamLines', () => {
  it('разбирает строки «ключ: значение» из колонки «Параметры»', () => {
    const params = parseParamLines([
      ' comment: Добавление приходов Цессия ',
      'amount: 7.88',
      'income-date: 30.09.2026',
      'income-type: цессия',
      'loan-id: 4174817',
    ]);
    expect(params).toEqual({
      comment: 'Добавление приходов Цессия',
      amount: '7.88',
      'income-date': '30.09.2026',
      'income-type': 'цессия',
      'loan-id': '4174817',
    });
  });

  it('делит по первому двоеточию и пропускает строки без ключа', () => {
    expect(parseParamLines(['comment: a: b', 'мусор', ': x'])).toEqual({ comment: 'a: b' });
  });
});

describe('parseAmount', () => {
  it('нормализует простые суммы', () => {
    expect(parseAmount('119,74')).toBe('119.74');
    expect(parseAmount('0.25')).toBe('0.25');
    expect(parseAmount('7.88')).toBe('7.88');
    expect(parseAmount('1234.5')).toBe('1234.5');
    expect(parseAmount('500')).toBe('500');
  });

  it('удаляет разделители тысяч (пробел, NBSP, точка, запятая)', () => {
    expect(parseAmount('1 234,56')).toBe('1234.56');
    expect(parseAmount('1\u00a0234,56')).toBe('1234.56');
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('1.234')).toBe('1234');
    expect(parseAmount('1 234 567')).toBe('1234567');
  });

  it('отрицательная сумма, текст вокруг, пустое значение', () => {
    expect(parseAmount('Сумма: -50,25 руб.')).toBe('-50.25');
    expect(parseAmount('нет чисел')).toBe('');
    expect(parseAmount(undefined)).toBe('');
  });
});

describe('toFormDateTime', () => {
  const now = new Date(2026, 9, 1, 9, 5, 7);
  it('DD.MM.YYYY → YYYY-MM-DD + текущее время', () => {
    expect(toFormDateTime('30.09.2026', now)).toBe('2026-09-30 09:05:07');
  });
  it('сохраняет явное время', () => {
    expect(toFormDateTime('30.09.2026 14:30', now)).toBe('2026-09-30 14:30:00');
  });
  it('ISO-дата без времени', () => {
    expect(toFormDateTime('2026-09-30', now)).toBe('2026-09-30 09:05:07');
  });
  it('пустая строка → пусто', () => {
    expect(toFormDateTime('', now)).toBe('');
  });
});

describe('resolveIncomeTypeOption', () => {
  const options = [
    { value: '', text: '' },
    { value: 'mi_tinkoff', text: 'Tinkoff' },
    { value: 'mi_cession', text: 'Цессия' },
    { value: 'mi_refund_product', text: 'Возврат продукта' },
  ];
  it('цессия → Цессия (регистронезависимо)', () => {
    expect(resolveIncomeTypeOption(options, 'цессия')).toBe('mi_cession');
    expect(resolveIncomeTypeOption(options, 'ЦЕССИЯ')).toBe('mi_cession');
  });
  it('ключи INCOME_TYPE_MAP: cession, mi_cession', () => {
    expect(resolveIncomeTypeOption(options, 'cession')).toBe('mi_cession');
    expect(resolveIncomeTypeOption(options, 'mi_cession')).toBe('mi_cession');
    expect(resolveIncomeTypeOption(options, 'mi_refund_product')).toBe('mi_refund_product');
  });
  it('NBSP и лишние пробелы нормализуются', () => {
    expect(resolveIncomeTypeOption(options, '\u00a0цессия  ')).toBe('mi_cession');
    expect(resolveIncomeTypeOption(options, 'возврат\u00a0 продукта')).toBe('mi_refund_product');
  });
  it('незамапленный тип ищется по тексту опции', () => {
    expect(resolveIncomeTypeOption(options, 'tinkoff')).toBe('mi_tinkoff');
    expect(resolveIncomeTypeOption(options, 'возврат')).toBe('mi_refund_product');
  });
  it('короткое значение не даёт частичного совпадения', () => {
    expect(resolveIncomeTypeOption(options, 'и')).toBe('');
    expect(resolveIncomeTypeOption(options, 'це')).toBe('');
  });
  it('нет совпадения → пусто', () => {
    expect(resolveIncomeTypeOption(options, 'неизвестно')).toBe('');
    expect(resolveIncomeTypeOption(options, '')).toBe('');
  });
});

describe('parseTicketFromHash', () => {
  it('ключ RUSUPPORT-N из #task=, регистр нормализуется', () => {
    expect(parseTicketFromHash('#task=RUSUPPORT-75812')).toBe('RUSUPPORT-75812');
    expect(parseTicketFromHash('#task=rusupport-75812')).toBe('RUSUPPORT-75812');
    expect(parseTicketFromHash('#foo=1&task=%20RUSUPPORT-75812%20')).toBe('RUSUPPORT-75812');
  });
  it('голый номер дополняется префиксом', () => {
    expect(parseTicketFromHash('#task=75812')).toBe('RUSUPPORT-75812');
  });
  it('нет task или чужой формат → пусто', () => {
    expect(parseTicketFromHash('')).toBe('');
    expect(parseTicketFromHash(undefined)).toBe('');
    expect(parseTicketFromHash('#task=RU-22813')).toBe('');
    expect(parseTicketFromHash('#task=RUSUPPORT-')).toBe('');
  });
});

describe('buildComment', () => {
  it('комментарий — ровно ключ тикета, даже если в параметрах есть comment', () => {
    expect(buildComment('RUSUPPORT-75812', 'Добавление приходов Цессия')).toBe('RUSUPPORT-75812');
    expect(buildComment('RUSUPPORT-75812', undefined)).toBe('RUSUPPORT-75812');
  });
  it('без тикета — comment из параметров или пусто', () => {
    expect(buildComment('', ' Добавление приходов Цессия ')).toBe('Добавление приходов Цессия');
    expect(buildComment('', undefined)).toBe('');
  });
});
