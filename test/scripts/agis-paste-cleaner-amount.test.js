import { describe, it, expect } from 'vitest';
import { cleanInput } from '../../scripts/agis-paste-cleaner-amount.user.js';

describe('cleanInput', () => {
  it('оставляет только цифры', () => {
    expect(cleanInput('1234')).toBe('1234');
  });

  it('вырезает буквы вокруг числа', () => {
    expect(cleanInput('abc123.45xyz')).toBe('123.45');
  });

  it('обрезает точки/запятые по краям, но не внутри', () => {
    expect(cleanInput('.123,45.')).toBe('123,45');
  });

  it('убирает пробелы (не цифры/точки/запятые)', () => {
    expect(cleanInput('  1 000  ')).toBe('1000');
  });

  it('пустой/отсутствующий ввод даёт пустую строку', () => {
    expect(cleanInput('')).toBe('');
    expect(cleanInput(null)).toBe('');
    expect(cleanInput(undefined)).toBe('');
  });

  it('обрезает дефисы по краям (не цифра)', () => {
    expect(cleanInput('--12--')).toBe('12');
  });
});
