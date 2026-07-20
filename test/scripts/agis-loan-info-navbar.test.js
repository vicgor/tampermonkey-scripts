import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  pad2,
  toTwoDigitYear,
  isValidDateParts,
  buildShortDate,
  extractValue,
  compactData,
  hasUsefulData,
} from '../../scripts/agis-loan-info-navbar.user.js';

describe('normalizeText', () => {
  it('схлопывает пробелы/табы и обрезает края', () => {
    expect(normalizeText('a   b\tc')).toBe('a b c');
  });

  it('пустой/отсутствующий ввод даёт пустую строку', () => {
    expect(normalizeText(null)).toBe('');
  });
});

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
