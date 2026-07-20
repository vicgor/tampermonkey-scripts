import { describe, it, expect } from 'vitest';
import { getTokenRe } from '../../scripts/agis-linkify-loan-note.user.js';

describe('getTokenRe', () => {
  it('находит markdown-ссылку [text](url)', () => {
    expect('[link](https://x.io)'.match(getTokenRe())).toEqual(['[link](https://x.io)']);
  });

  it('находит голый URL', () => {
    expect('see https://example.com/path?a=1 more'.match(getTokenRe())).toEqual(['https://example.com/path?a=1']);
  });

  it('находит тикет Jira RUSUPPORT-N', () => {
    expect('ticket RUSUPPORT-12345 here'.match(getTokenRe())).toEqual(['RUSUPPORT-12345']);
  });

  it('не находит ничего в обычном тексте', () => {
    expect('plain text no tokens'.match(getTokenRe())).toBeNull();
  });

  it('возвращает новый regex-объект при каждом вызове (global flag не залипает между вызовами)', () => {
    expect(getTokenRe()).not.toBe(getTokenRe());
    expect(getTokenRe().lastIndex).toBe(0);
  });
});
