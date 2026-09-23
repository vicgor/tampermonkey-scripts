import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { checkCoreRequires, extractSha256, parseMetablock, sha256, sriMatches } from '../../scripts/validate-meta.js';

// Фейковое «ядро в теге» — тесты не зависят от реальных git-тегов в чекауте.
const CORE = Buffer.from('/* agis-core */\n');
const B64 = createHash('sha256').update(CORE).digest('base64');
const HEX = createHash('sha256').update(CORE).digest('hex');
const BASE = 'https://raw.githubusercontent.com/vicgor/tampermonkey-scripts';
const OK_URL = `${BASE}/v1.4.0/lib/agis-core.js#sha256=${B64}`;
const readFile = (tag) => (tag === 'v1.4.0' ? { content: CORE } : { error: `тег ${tag} не найден (fake)` });
const check = (values) => checkCoreRequires(values, readFile);

describe('checkCoreRequires', () => {
  it('корректный тег + хеш — без ошибок, 1 ссылка проверена', () => {
    expect(check([OK_URL])).toEqual({ errors: [], checked: 1 });
  });

  it('принимает hex-хеш', () => {
    expect(check([`${BASE}/v1.4.0/lib/agis-core.js#sha256=${HEX}`]).errors).toEqual([]);
  });

  it('принимает несколько хешей через запятую (#md5=...,sha256=...)', () => {
    expect(check([`${BASE}/v1.4.0/lib/agis-core.js#md5=abc,sha256=${B64}`]).errors).toEqual([]);
  });

  it('неверный хеш — ошибка с ожидаемым значением', () => {
    const { errors } = check([`${BASE}/v1.4.0/lib/agis-core.js#sha256=AAAA`]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('не совпадает');
    expect(errors[0]).toContain(B64);
  });

  it('ошибка чтения тега пробрасывается как есть', () => {
    const { errors } = check([`${BASE}/v9.9.9/lib/agis-core.js#sha256=${B64}`]);
    expect(errors).toEqual(['тег v9.9.9 не найден (fake)']);
  });

  it('ссылка на ветку вместо тега — ошибка', () => {
    const { errors } = check([`${BASE}/main/lib/agis-core.js#sha256=${B64}`]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('не на тег');
  });

  it('пре-релизный тег (v1.5.0-rc1) не принимается', () => {
    const { errors } = check([`${BASE}/v1.5.0-rc1/lib/agis-core.js#sha256=${B64}`]);
    expect(errors[0]).toContain('не на тег');
  });

  it('без #sha256 — ошибка', () => {
    const { errors } = check([`${BASE}/v1.4.0/lib/agis-core.js`]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('#sha256');
  });

  it.each([
    ['http:// вместо https://', OK_URL.replace('https://', 'http://')],
    [
      'зеркало jsDelivr',
      `https://cdn.jsdelivr.net/gh/vicgor/tampermonkey-scripts@v1.4.0/lib/agis-core.js#sha256=${B64}`,
    ],
    ['путь refs/tags/', OK_URL.replace('/v1.4.0/', '/refs/tags/v1.4.0/')],
    ['другой регистр в имени файла', OK_URL.replace('agis-core.js', 'AGIS-Core.js')],
    ['комментарий в конце строки', `${OK_URL}  // <- ОБНОВИТЬ тег`],
  ])('нестандартная ссылка на ядро (%s) — ошибка, а не пропуск', (_label, url) => {
    const { errors, checked } = check([url]);
    expect(checked).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('чужие @require не проверяются и не считаются', () => {
    expect(check(['https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js'])).toEqual({ errors: [], checked: 0 });
  });
});

describe('parseMetablock + checkCoreRequires', () => {
  it('хвост-комментарий в строке @require попадает в значение и ловится', () => {
    const content = `// ==UserScript==\n// @require      ${OK_URL}  // <- ОБНОВИТЬ\n// ==/UserScript==\n`;
    const { fields } = parseMetablock(content, 'x.user.js');
    expect(fields.require[0]).toContain('// <- ОБНОВИТЬ');
    expect(check(fields.require).errors).toHaveLength(1);
  });
});

describe('extractSha256 / sriMatches', () => {
  it('extractSha256: нет фрагмента или нет sha256 — null', () => {
    expect(extractSha256(undefined)).toBeNull();
    expect(extractSha256('md5=abc')).toBeNull();
  });

  it('hex сравнивается без учёта регистра', () => {
    expect(sriMatches(HEX.toUpperCase(), sha256(CORE))).toBe(true);
  });
});
