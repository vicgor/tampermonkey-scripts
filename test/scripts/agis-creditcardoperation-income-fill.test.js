import { describe, it, expect } from 'vitest';
import {
  parseAmount,
  normalizeDate,
  resolveIncomeType,
  isIncomingOperation,
  isPayloadFresh,
} from '../../scripts/agis-creditcardoperation-income-fill.user.js';

// Явные коды символов: литеральные nbsp не видны в диффе.
const NBSP = String.fromCharCode(0x00a0);
const NARROW_NBSP = String.fromCharCode(0x202f);

describe('parseAmount', () => {
  it('разбирает сумму с nbsp-разделителем тысяч, запятой и знаком рубля', () => {
    expect(parseAmount(`4${NBSP}640,00${NBSP}₽`)).toBe('4640.00');
  });

  it('разбирает сумму с narrow nbsp (Intl.NumberFormat ru-RU)', () => {
    expect(parseAmount(`20${NARROW_NBSP}000,00 ₽`)).toBe('20000.00');
  });

  it('возвращает пустую строку, если числа нет', () => {
    expect(parseAmount('—')).toBe('');
  });
});

describe('normalizeDate', () => {
  it('переводит дату списка операций в формат поля incomeDate', () => {
    expect(normalizeDate('28 авг. 2026 г., 16:52:58')).toBe('2026-08-28 16:52:58');
  });

  it('понимает "сент." и дополняет день нулём', () => {
    expect(normalizeDate('8 сент. 2026 г., 07:33:51')).toBe('2026-09-08 07:33:51');
  });

  it('возвращает пустую строку для неизвестного месяца или пустого значения', () => {
    expect(normalizeDate('28 foo 2026 г., 16:52:58')).toBe('');
    expect(normalizeDate('')).toBe('');
  });
});

describe('resolveIncomeType', () => {
  it('сопоставляет шлюз операции value опции manualIncomeType', () => {
    expect(resolveIncomeType('siab_bank')).toBe('MI_Siab');
    expect(resolveIncomeType('e2c')).toBe('MI_Tinkoff');
    expect(resolveIncomeType('mapi_sbp')).toBe('MI_Tinkoff');
    expect(resolveIncomeType('euro_alliance')).toBe('MI_EuroAlliance');
  });

  it('регистро- и пробелонезависим', () => {
    expect(resolveIncomeType('  SIAB_BANK ')).toBe('MI_Siab');
  });

  it('возвращает пустую строку для неизвестного шлюза — тип выбирается вручную', () => {
    expect(resolveIncomeType('unknown_gateway')).toBe('');
    expect(resolveIncomeType('')).toBe('');
  });
});

describe('isIncomingOperation', () => {
  it('входящие — repayment и rebill_payment', () => {
    expect(isIncomingOperation('repayment')).toBe(true);
    expect(isIncomingOperation('rebill_payment')).toBe(true);
  });

  it('выдача и верификация карты — не приход', () => {
    expect(isIncomingOperation('money_transfer')).toBe(false);
    expect(isIncomingOperation('verification')).toBe(false);
  });
});

describe('isPayloadFresh', () => {
  const savedAt = 1_000_000;
  const minuteMs = 60 * 1000;

  it('свежий payload — в пределах 30 минут', () => {
    expect(isPayloadFresh({ savedAt }, savedAt + 30 * minuteMs)).toBe(true);
  });

  it('просроченный payload', () => {
    expect(isPayloadFresh({ savedAt }, savedAt + 30 * minuteMs + 1)).toBe(false);
  });

  it('payload без savedAt, с savedAt из будущего или не объект — не свежий', () => {
    expect(isPayloadFresh({ amount: '100' }, savedAt)).toBe(false);
    expect(isPayloadFresh({ savedAt }, savedAt - 1)).toBe(false);
    expect(isPayloadFresh(null, savedAt)).toBe(false);
  });
});
