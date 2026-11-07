import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ruMonthNumber, normalizeText, cellText, storageList, storagePrune } from '../../lib/agis-core.js';

describe('ruMonthNumber', () => {
  it('распознаёт полное название месяца', () => {
    expect(ruMonthNumber('январь')).toBe('01');
    expect(ruMonthNumber('декабря')).toBe('12');
  });

  it('распознаёт сокращения с точкой и без', () => {
    expect(ruMonthNumber('янв.')).toBe('01');
    expect(ruMonthNumber('янв')).toBe('01');
  });

  it('регистронезависим и обрезает пробелы', () => {
    expect(ruMonthNumber('ЯНВАРЬ')).toBe('01');
    expect(ruMonthNumber('  март  ')).toBe('03');
  });

  it('покрывает все 12 месяцев', () => {
    expect(ruMonthNumber('январь')).toBe('01');
    expect(ruMonthNumber('фев')).toBe('02');
    expect(ruMonthNumber('март')).toBe('03');
    expect(ruMonthNumber('апрель')).toBe('04');
    expect(ruMonthNumber('май')).toBe('05');
    expect(ruMonthNumber('июнь')).toBe('06');
    expect(ruMonthNumber('июль')).toBe('07');
    expect(ruMonthNumber('август')).toBe('08');
    expect(ruMonthNumber('сентябрь')).toBe('09');
    expect(ruMonthNumber('октябрь')).toBe('10');
    expect(ruMonthNumber('ноябрь')).toBe('11');
    expect(ruMonthNumber('декабрь')).toBe('12');
  });

  it('возвращает null для нераспознанного/пустого ввода', () => {
    expect(ruMonthNumber('foo')).toBeNull();
    expect(ruMonthNumber('')).toBeNull();
    expect(ruMonthNumber(null)).toBeNull();
    expect(ruMonthNumber(undefined)).toBeNull();
  });
});

// Волна 5: перенесены из agis-loan-info-navbar.user.js/agis-protocol-income-fill.user.js
// (обе версии были буквально идентичны) и заинлайненного варианта в
// agis-duplicate-income.user.js — см. ROADMAP.md.
describe('normalizeText', () => {
  it('схлопывает повторяющиеся пробелы/табы/переводы строк и обрезает края', () => {
    expect(normalizeText('a   b\tc\n\nd')).toBe('a b c d');
    expect(normalizeText('  x  ')).toBe('x');
  });

  it('nbsp (\\u00a0) тоже схлопывается — \\s в JS уже покрывает его', () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(normalizeText(`a${nbsp}b`)).toBe('a b');
  });

  it('пустой/отсутствующий ввод даёт пустую строку', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  it('приводит нестроковые значения через String()', () => {
    expect(normalizeText(42)).toBe('42');
  });
});

describe('cellText', () => {
  it('нормализует textContent переданного узла', () => {
    expect(cellText({ textContent: '  x   y  ' })).toBe('x y');
  });

  it('null/undefined даёт пустую строку, не исключение', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });
});

// GM_* в Tampermonkey — глобальные функции; ядро разрешает их в момент вызова,
// поэтому достаточно подменить globalThis на время теста.
describe('storageList / storagePrune (v1.5.0)', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.GM_listValues = () => [...store.keys()];
    globalThis.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
    globalThis.GM_deleteValue = (key) => store.delete(key);
  });
  afterEach(() => {
    delete globalThis.GM_listValues;
    delete globalThis.GM_getValue;
    delete globalThis.GM_deleteValue;
    vi.restoreAllMocks();
  });

  it('storageList фильтрует по префиксу', async () => {
    store.set('agis:x:payload:v1:1', {});
    store.set('agis:x:payload:v1:2', {});
    store.set('agis:x:debug', true);
    store.set('agis:y:payload:v1:1', {});
    expect((await storageList('agis:x:payload:v1:')).sort()).toEqual(['agis:x:payload:v1:1', 'agis:x:payload:v1:2']);
  });

  it('storageList без префикса — все ключи', async () => {
    store.set('a', 1);
    store.set('b', 2);
    expect((await storageList()).sort()).toEqual(['a', 'b']);
  });

  it('storageList поддерживает асинхронный GM_listValues', async () => {
    store.set('agis:x:1', 1);
    globalThis.GM_listValues = async () => [...store.keys()];
    expect(await storageList('agis:x:')).toEqual(['agis:x:1']);
  });

  it('storageList при ошибке GM_listValues возвращает [] и предупреждает', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.GM_listValues = () => {
      throw new Error('not granted');
    };
    expect(await storageList('agis:')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('storagePrune удаляет только просроченные ключи своего префикса', async () => {
    const now = Date.now();
    store.set('agis:x:payload:v1:old', { createdAt: now - 60_000 });
    store.set('agis:x:payload:v1:fresh', { createdAt: now });
    store.set('agis:x:payload:v1:broken', null);
    store.set('agis:x:debug', true);
    const removed = await storagePrune('agis:x:payload:v1:', (p) => !p || now - p.createdAt > 30_000);
    expect(removed).toBe(2);
    expect([...store.keys()].sort()).toEqual(['agis:x:debug', 'agis:x:payload:v1:fresh']);
  });

  it('storagePrune передаёт ключ вторым аргументом и ждёт асинхронный предикат', async () => {
    store.set('agis:x:1', 1);
    store.set('agis:x:2', 2);
    const removed = await storagePrune('agis:x:', async (_value, key) => key.endsWith(':2'));
    expect(removed).toBe(1);
    expect([...store.keys()]).toEqual(['agis:x:1']);
  });

  it('storagePrune оставляет ключ, если предикат бросил исключение', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.set('agis:x:1', 1);
    store.set('agis:x:2', 2);
    const removed = await storagePrune('agis:x:', (value) => {
      if (value === 1) throw new Error('bad');
      return true;
    });
    expect(removed).toBe(1);
    expect([...store.keys()]).toEqual(['agis:x:1']);
  });
});
