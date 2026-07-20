import { describe, it, expect } from 'vitest';
import { normalizePathKey, hasKeyword, textHash } from '../../scripts/agis-rusupport-clipboard.user.js';

describe('normalizePathKey', () => {
  it('схлопывает повторяющиеся слэши', () => {
    expect(normalizePathKey('/a//b///c/')).toBe('/a/b/c');
  });

  it('корень пути остаётся "/"', () => {
    expect(normalizePathKey('/')).toBe('/');
  });

  it('пустая строка нормализуется в "/"', () => {
    expect(normalizePathKey('')).toBe('/');
  });
});

describe('hasKeyword', () => {
  it('находит RUSUPPORT-тикет как отдельное слово', () => {
    expect(hasKeyword('this has RUSUPPORT-123 in it')).toBe(true);
  });

  it('не находит ключевое слово в обычном тексте', () => {
    expect(hasKeyword('no keyword here')).toBe(false);
  });

  it('не матчит RUSUPPORT как часть другого слова', () => {
    expect(hasKeyword('xRUSUPPORTy')).toBe(false);
  });
});

describe('textHash', () => {
  it('детерминирован для одинакового текста', () => {
    expect(textHash('hello')).toBe(textHash('hello'));
  });

  it('пустая строка даёт хеш 0', () => {
    expect(textHash('')).toBe('0');
  });

  it('возвращает строку', () => {
    expect(typeof textHash('hello')).toBe('string');
  });

  it('падает на null/undefined — вызывающий код (appendText) всегда передаёт результат .trim(), не null-safe по дизайну', () => {
    expect(() => textHash(null)).toThrow();
    expect(() => textHash(undefined)).toThrow();
  });
});
