import { describe, it, expect } from 'vitest';
import {
  pad2,
  toTwoDigitYear,
  isValidDateParts,
  buildShortDate,
  extractValue,
  compactData,
  hasUsefulData,
  formatDateDDMMYY,
  applyDateFormatting,
  statusColor,
} from '../../scripts/agis-loan-info-navbar.user.js';

// normalizeText больше не экспортируется этим файлом — теперь из lib/agis-core.js,
// тестируется один раз в test/lib/agis-core.test.js (см. ROADMAP.md).

describe('pad2', () => {
  it('добавляет ведущий ноль для однозначных чисел', () => {
    expect(pad2(3)).toBe('03');
  });

  it('не трогает двузначные числа', () => {
    expect(pad2(11)).toBe('11');
  });
});

describe('toTwoDigitYear', () => {
  it('обрезает 4-значный год до 2 цифр', () => {
    expect(toTwoDigitYear(2024)).toBe('24');
  });

  it('оставляет 2-значный год как есть', () => {
    expect(toTwoDigitYear(24)).toBe('24');
  });

  it('возвращает null для нечислового или некорректной длины ввода', () => {
    expect(toTwoDigitYear('abc')).toBeNull();
    expect(toTwoDigitYear('202')).toBeNull();
  });
});

describe('isValidDateParts', () => {
  it('валидная дата проходит проверку', () => {
    expect(isValidDateParts(15, 6, 2024)).toBe(true);
  });

  it('день/месяц вне диапазона отклоняются', () => {
    expect(isValidDateParts(32, 6, 2024)).toBe(false);
    expect(isValidDateParts(15, 13, 2024)).toBe(false);
  });

  it('нечисловые части отклоняются', () => {
    expect(isValidDateParts('a', 'b', 'c')).toBe(false);
  });
});

describe('buildShortDate', () => {
  it('собирает дд.мм.гг с ведущими нулями', () => {
    expect(buildShortDate(5, 6, 2024)).toBe('05.06.24');
  });

  it('возвращает null для невалидной даты', () => {
    expect(buildShortDate(32, 6, 2024)).toBeNull();
  });
});

describe('extractValue', () => {
  it('извлекает значение между ключом и стоп-словом', () => {
    expect(extractValue('Статус: Активный Дата: 01.01.2024', 'Статус', /Дата/)).toBe('Активный');
  });

  it('возвращает null, если ключ не найден', () => {
    expect(extractValue('нет тут ключа', 'Статус', /Дата/)).toBeNull();
  });

  it('возвращает null для пустого текста', () => {
    expect(extractValue('', 'Статус', /Дата/)).toBeNull();
  });
});

describe('compactData', () => {
  it('убирает пустые/null поля и нормализует текст', () => {
    expect(compactData({ a: '  x ', b: '', c: null, d: 'y' })).toEqual({ a: 'x', d: 'y' });
  });
});

describe('hasUsefulData', () => {
  it('true, если есть хотя бы одно непустое значение', () => {
    expect(hasUsefulData({ a: '', b: 'x' })).toBe(true);
  });

  it('false, если все значения пусты', () => {
    expect(hasUsefulData({ a: '', b: '' })).toBe(false);
  });

  it('false для null', () => {
    expect(hasUsefulData(null)).toBe(false);
  });
});

describe('formatDateDDMMYY', () => {
  it('распознаёт ISO-формат', () => {
    expect(formatDateDDMMYY('2026-06-03')).toBe('03.06.26');
  });

  it('распознаёт числовой формат дд.мм.гггг', () => {
    expect(formatDateDDMMYY('03.06.2026')).toBe('03.06.26');
  });

  it('распознаёт текстовый формат AGIS с хвостовым текстом', () => {
    expect(formatDateDDMMYY('9 мар. 2026 г. на 24 дня')).toBe('09.03.26');
  });

  it('нераспознанный текст возвращает как есть', () => {
    expect(formatDateDDMMYY('какой-то текст')).toBe('какой-то текст');
  });

  it('пустой/отсутствующий ввод даёт null', () => {
    expect(formatDateDDMMYY('')).toBeNull();
    expect(formatDateDDMMYY(null)).toBeNull();
  });
});

describe('applyDateFormatting', () => {
  it('форматирует даты и убирает пустые поля через compactData', () => {
    expect(
      applyDateFormatting({
        issuedOn: '25 февр. 2025 г.',
        dueDate: '27 мар. 2025 г.',
        extendedTo: null,
        priceList: 'X',
      }),
    ).toEqual({ issuedOn: '25.02.25', dueDate: '27.03.25', priceList: 'X' });
  });
});

describe('statusColor', () => {
  it('красный для просроченных/проданных статусов', () => {
    expect(statusColor('Продан')).toEqual({ bg: '#f2dede', fg: '#a94442', bd: '#ebccd1' });
  });

  it('зелёный для активного кредита', () => {
    expect(statusColor('Активный кредит')).toEqual({ bg: '#dff0d8', fg: '#3c763d', bd: '#d6e9c6' });
  });

  it('серый для возвращённого кредита', () => {
    expect(statusColor('Кредит возвращен')).toEqual({ bg: '#e7e7e7', fg: '#555555', bd: '#d0d0d0' });
  });

  it('жёлтый для новой заявки', () => {
    expect(statusColor('Новая заявка')).toEqual({ bg: '#fcf8e3', fg: '#8a6d3b', bd: '#faebcc' });
  });

  it('синий (default) для неизвестного/пустого статуса', () => {
    const fallback = { bg: '#d9edf7', fg: '#31708f', bd: '#bce8f1' };
    expect(statusColor('Неизвестный статус')).toEqual(fallback);
    expect(statusColor('')).toEqual(fallback);
  });
});
