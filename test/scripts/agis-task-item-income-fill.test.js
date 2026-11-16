import { describe, it, expect } from 'vitest';
import {
  parseParamLines,
  parseAmount,
  toFormDateTime,
  resolveIncomeTypeOption,
  parseTicketFromHash,
  buildComment,
  parseIncomeLinkHash,
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
    { value: 'MI_RussianPost', text: 'Почта России' },
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
  it('код MI_* находится по value опции, даже если текст другой', () => {
    const renamed = [{ value: 'MI_Alfa', text: 'Альфа Банк (новое название)' }];
    expect(resolveIncomeTypeOption(renamed, 'MI_Alfa')).toBe('MI_Alfa');
    expect(resolveIncomeTypeOption(renamed, 'mi_alfa')).toBe('MI_Alfa');
  });
  it('Почта России: текст опции и код MI_RussianPost', () => {
    expect(resolveIncomeTypeOption(options, 'Почта России')).toBe('MI_RussianPost');
    expect(resolveIncomeTypeOption(options, 'MI_RussianPost')).toBe('MI_RussianPost');
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
  it('нет параметра task → null (можно взять сохранённый тикет)', () => {
    expect(parseTicketFromHash('')).toBeNull();
    expect(parseTicketFromHash(undefined)).toBeNull();
    expect(parseTicketFromHash('#foo=1')).toBeNull();
  });
  it('task есть, но некорректен → пустая строка (не подменять сохранённым)', () => {
    expect(parseTicketFromHash('#task=')).toBe('');
    expect(parseTicketFromHash('#task=RUSUPORT-75813')).toBe('');
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

describe('parseIncomeLinkHash', () => {
  it('полный набор параметров ссылки из рецепта', () => {
    const hash =
      '#task=RUSUPPORT-77537&incomeDate=2026-11-05&amount=16426.00&incomeType=%D0%9F%D0%BE%D1%87%D1%82%D0%B0%20%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D0%B8&paymentId=A123';
    expect(parseIncomeLinkHash(hash)).toEqual({
      ticket: 'RUSUPPORT-77537',
      ticketInvalid: false,
      incomeDate: '2026-11-05',
      amount: '16426.00',
      incomeType: 'Почта России',
      paymentId: 'A123',
      error: '',
    });
  });
  it('без task, вида и ИД платежа; сумма с пробелами и запятой', () => {
    expect(parseIncomeLinkHash('#incomeDate=05.11.2026&amount=16%20426,00')).toEqual({
      ticket: '',
      ticketInvalid: false,
      incomeDate: '05.11.2026',
      amount: '16426.00',
      incomeType: '',
      paymentId: '',
      error: '',
    });
  });
  it('некорректный task — тикет пустой, ticketInvalid', () => {
    const link = parseIncomeLinkHash('#task=abc&incomeDate=2026-11-05&amount=1');
    expect(link.ticket).toBe('');
    expect(link.ticketInvalid).toBe(true);
    expect(link.error).toBe('');
  });
  it('нет ни даты, ни суммы — null (обычное открытие займа)', () => {
    expect(parseIncomeLinkHash('#task=RUSUPPORT-1')).toBeNull();
    expect(parseIncomeLinkHash('')).toBeNull();
    expect(parseIncomeLinkHash(undefined)).toBeNull();
  });
  it('негодные дата или сумма — error, платёж не сохраняется', () => {
    expect(parseIncomeLinkHash('#task=RUSUPPORT-1&incomeDate=2026-11-05').error).toMatch(/сумма/);
    expect(parseIncomeLinkHash('#incomeDate=2026-11-05&amount=0').error).toMatch(/сумма/);
    expect(parseIncomeLinkHash('#incomeDate=2026-11-05&amount=-5').error).toMatch(/сумма/);
    expect(parseIncomeLinkHash('#incomeDate=2026-11-05T10:00&amount=1').error).toMatch(/дата/);
    expect(parseIncomeLinkHash('#amount=100').error).toMatch(/дата/);
  });
});
