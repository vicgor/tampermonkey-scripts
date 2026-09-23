import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { checkCoreRequires, sriMatches } from '../../scripts/validate-meta.js';

// Фейковое «ядро в теге» — тесты не зависят от реальных git-тегов в чекауте.
const CORE = Buffer.from('/* agis-core */\n');
const B64 = createHash('sha256').update(CORE).digest('base64');
const HEX = createHash('sha256').update(CORE).digest('hex');
const BASE = 'https://raw.githubusercontent.com/vicgor/tampermonkey-scripts';
const readFile = (tag) => (tag === 'v1.4.0' ? CORE : null);

describe('checkCoreRequires', () => {
  it('корректный тег + хеш — без ошибок', () => {
    expect(checkCoreRequires([`${BASE}/v1.4.0/lib/agis-core.js#sha256=${B64}`], readFile)).toEqual([]);
  });

  it('принимает hex-хеш', () => {
    expect(checkCoreRequires([`${BASE}/v1.4.0/lib/agis-core.js#sha256=${HEX}`], readFile)).toEqual([]);
  });

  it('неверный хеш — ошибка с ожидаемым значением', () => {
    const errors = checkCoreRequires([`${BASE}/v1.4.0/lib/agis-core.js#sha256=AAAA`], readFile);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('не совпадает');
    expect(errors[0]).toContain(B64);
  });

  it('несуществующий тег — ошибка', () => {
    const errors = checkCoreRequires([`${BASE}/v9.9.9/lib/agis-core.js#sha256=${B64}`], readFile);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('не найден');
  });

  it('ссылка на ветку вместо тега — ошибка', () => {
    const errors = checkCoreRequires([`${BASE}/main/lib/agis-core.js#sha256=${B64}`], readFile);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('не на тег');
  });

  it('без #sha256 — ошибка', () => {
    const errors = checkCoreRequires([`${BASE}/v1.4.0/lib/agis-core.js`], readFile);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('#sha256');
  });

  it('чужие @require не проверяются', () => {
    expect(checkCoreRequires(['https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js'], readFile)).toEqual([]);
  });
});

describe('sriMatches', () => {
  it('hex сравнивается без учёта регистра', () => {
    expect(sriMatches(HEX.toUpperCase(), CORE)).toBe(true);
  });
});
