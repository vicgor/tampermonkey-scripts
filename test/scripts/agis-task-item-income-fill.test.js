import { describe, it, expect } from 'vitest';
import {
  parseParamLines,
  parseAmount,
  toFormDateTime,
  resolveIncomeTypeOption,
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
  it('нормализует сумму', () => {
    expect(parseAmount('119,74')).toBe('119.74');
    expect(parseAmount('0.25')).toBe('0.25');
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
  it('незамапленный тип ищется по тексту опции', () => {
    expect(resolveIncomeTypeOption(options, 'tinkoff')).toBe('mi_tinkoff');
  });
  it('нет совпадения → пусто', () => {
    expect(resolveIncomeTypeOption(options, 'неизвестно')).toBe('');
    expect(resolveIncomeTypeOption(options, '')).toBe('');
  });
});
