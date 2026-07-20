import { describe, it, expect } from 'vitest';
import { parseCSV, tokenizeCSV, pad } from '../../scripts/agis-add-income-from-googlesheet.user.js';

describe('tokenizeCSV', () => {
  it('разбивает простой CSV на строки/поля', () => {
    expect(tokenizeCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('понимает запятую внутри кавычек', () => {
    expect(tokenizeCSV('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('понимает экранированные кавычки ("")', () => {
    expect(tokenizeCSV('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('нормализует CRLF в LF', () => {
    expect(tokenizeCSV('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('не создаёт лишнюю пустую строку из-за завершающего \\n', () => {
    expect(tokenizeCSV('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('пустой ввод даёт пустой массив строк', () => {
    expect(tokenizeCSV('')).toEqual([]);
  });
});

describe('parseCSV', () => {
  const csv = [
    'loanid,amount,paramIncomeDate,incomeType,comment',
    '42, 100.50 ,2024-01-01,manual,hello',
    ',999,2024-01-02,manual,skip-me',
    '',
  ].join('\n');

  it('строит объект по loanid, обрезая пробелы в значениях', () => {
    expect(parseCSV(csv)).toEqual({
      42: { order: '-', sum: '100.50', date: '2024-01-01', incomeType: 'manual', comment: 'hello' },
    });
  });

  it('пропускает строки без loanid', () => {
    const result = parseCSV(csv);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it('без строк данных возвращает пустой объект', () => {
    expect(parseCSV('loanid,amount')).toEqual({});
  });
});

describe('pad', () => {
  it('добавляет ведущий ноль для однозначных чисел', () => {
    expect(pad(5)).toBe('05');
    expect(pad(0)).toBe('00');
  });

  it('возвращает число как есть для >= 10 (не строку)', () => {
    expect(pad(12)).toBe(12);
  });

  it('граница ровно на 10 — уже число, не строка', () => {
    expect(pad(10)).toBe(10);
    expect(pad(9)).toBe('09');
  });
});
