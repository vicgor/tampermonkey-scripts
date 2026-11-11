import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const {
  parseRoute,
  parseMoneyToKopecks,
  formatRubles,
  formatAmountForInput,
  normalizeComparable,
  extractDepositFromText,
  scoreFieldDescription,
  isPayloadUsable,
  isPayloadExpired,
  shouldPrunePayload,
  storageKey,
  PAYLOAD_KEY_PREFIX,
} = require('../../scripts/agis-deposit-refund.user.js');

describe('parseRoute', () => {
  it('распознаёт карточку займа', () => {
    expect(parseRoute('/admin/agis2/core/loan/123456/edit')).toEqual({ loanId: '123456', page: 'edit' });
  });

  it('распознаёт форму создания транзакции (с завершающим слэшем тоже)', () => {
    expect(parseRoute('/admin/agis2/core/loan/77/loantransaction/create')).toEqual({ loanId: '77', page: 'create' });
    expect(parseRoute('/admin/agis2/core/loan/77/loantransaction/create/')).toEqual({ loanId: '77', page: 'create' });
  });

  it('возвращает null на посторонних путях займа', () => {
    expect(parseRoute('/admin/agis2/core/loan/123/income/list')).toBeNull();
    expect(parseRoute('/admin/agis2/core/loan-extended/123/edit')).toBeNull();
    expect(parseRoute('/admin/agis2/core/loan/abc/edit')).toBeNull();
    expect(parseRoute('')).toBeNull();
    expect(parseRoute(null)).toBeNull();
  });
});

describe('parseMoneyToKopecks', () => {
  it('разбирает суммы AGIS с пробелами-разделителями и запятой', () => {
    expect(parseMoneyToKopecks('1 234,56 ₽')).toBe(123456);
    expect(parseMoneyToKopecks('1\u00a0234,56 ₽')).toBe(123456);
    expect(parseMoneyToKopecks('1\u202f234.56')).toBe(123456);
  });

  it('держит копейки целыми (без float-погрешности)', () => {
    expect(parseMoneyToKopecks('1234.56')).toBe(123456);
    expect(parseMoneyToKopecks('0,07')).toBe(7);
    expect(parseMoneyToKopecks('8,29')).toBe(829);
  });

  it('понимает нули и отрицательные значения', () => {
    expect(parseMoneyToKopecks('0,00 ₽')).toBe(0);
    expect(parseMoneyToKopecks('-500,00 ₽')).toBe(-50000);
  });

  it('возвращает null, если числа нет', () => {
    expect(parseMoneyToKopecks('нет данных')).toBeNull();
    expect(parseMoneyToKopecks('')).toBeNull();
    expect(parseMoneyToKopecks(null)).toBeNull();
  });
});

describe('formatRubles / formatAmountForInput', () => {
  it('форматирует рубли для отображения', () => {
    const formatted = formatRubles(123456);
    expect(formatted).toMatch(/1.234,56/);
    expect(formatted).toContain('₽');
  });

  it('форматирует сумму для input — точка и ровно две цифры', () => {
    expect(formatAmountForInput(123456)).toBe('1234.56');
    expect(formatAmountForInput(7)).toBe('0.07');
    expect(formatAmountForInput(100000)).toBe('1000.00');
  });
});

describe('normalizeComparable', () => {
  it('сжимает пробелы, режет края и приводит к нижнему регистру', () => {
    expect(normalizeComparable('  Тип\u00a0 ТРАНЗАКЦИИ \n')).toBe('тип транзакции');
    expect(normalizeComparable(null)).toBe('');
  });
});

describe('extractDepositFromText', () => {
  it('находит «ДС на счету» в тексте страницы', () => {
    const result = extractDepositFromText('Займ #1 Статус: Активен ДС на счету: 1 234,56 ₽ Дата возврата: 01.09.2026');
    expect(result.kopecks).toBe(123456);
    expect(result.sourceText).toBe('ДС на счету: 1 234,56 ₽');
  });

  it('терпит отсутствие двоеточия и nbsp внутри числа', () => {
    expect(extractDepositFromText('ДС на счету 8\u00a0200,00 ₽').kopecks).toBe(820000);
  });

  it('распознаёт нулевой и отрицательный депозит (кнопка потом блокируется)', () => {
    expect(extractDepositFromText('ДС на счету: 0,00 ₽').kopecks).toBe(0);
    expect(extractDepositFromText('ДС на счету: -300,00 ₽').kopecks).toBe(-30000);
  });

  it('возвращает null, если метки нет', () => {
    expect(extractDepositFromText('Остаток задолженности: 1 000,00 ₽')).toBeNull();
    expect(extractDepositFromText('')).toBeNull();
  });
});

describe('scoreFieldDescription', () => {
  it('даёт по 10 за каждый совпавший паттерн', () => {
    expect(scoreFieldDescription('сумма транзакции amount', [/amount/iu, /сумм/iu])).toBe(20);
    expect(scoreFieldDescription('сумма', [/amount/iu, /сумм/iu])).toBe(10);
    expect(scoreFieldDescription('внешний id', [/amount/iu, /сумм/iu])).toBe(0);
  });
});

describe('isPayloadUsable', () => {
  const now = 1_700_000_000_000;
  const fresh = { loanId: '42', kopecks: 123456, createdAt: now - 60_000 };

  it('пропускает свежий payload того же займа', () => {
    expect(isPayloadUsable(fresh, '42', now)).toBe(true);
  });

  it('отбрасывает чужой заём, просрочку и неположительную сумму', () => {
    expect(isPayloadUsable(fresh, '43', now)).toBe(false);
    expect(isPayloadUsable({ ...fresh, createdAt: now - 16 * 60 * 1000 }, '42', now)).toBe(false);
    expect(isPayloadUsable({ ...fresh, kopecks: 0 }, '42', now)).toBe(false);
    expect(isPayloadUsable({ ...fresh, kopecks: -1 }, '42', now)).toBe(false);
  });

  it('отбрасывает мусор вместо payload', () => {
    expect(isPayloadUsable(null, '42', now)).toBe(false);
    expect(isPayloadUsable({ loanId: '42' }, '42', now)).toBe(false);
    expect(isPayloadUsable({ loanId: '42', kopecks: 100, createdAt: 'вчера' }, '42', now)).toBe(false);
  });
});

describe('isPayloadExpired (уборка хранилища)', () => {
  const now = 1_700_000_000_000;
  const TTL = 15 * 60 * 1000;

  it('свежий payload не трогает — даже другого займа и с нулевой суммой', () => {
    // В отличие от isPayloadUsable: соседняя вкладка могла только что подготовить
    // возврат по другому займу, уборка не должна его удалить.
    expect(isPayloadExpired({ loanId: '1', kopecks: 100, createdAt: now - 60_000 }, now)).toBe(false);
    expect(isPayloadExpired({ loanId: '2', kopecks: 0, createdAt: now }, now)).toBe(false);
  });

  it('граница TTL: ровно TTL — ещё жив, на 1 мс старше — просрочен', () => {
    expect(isPayloadExpired({ createdAt: now - TTL }, now)).toBe(false);
    expect(isPayloadExpired({ createdAt: now - TTL - 1 }, now)).toBe(true);
  });

  it('битый payload считается просроченным', () => {
    expect(isPayloadExpired(null, now)).toBe(true);
    expect(isPayloadExpired(undefined, now)).toBe(true);
    expect(isPayloadExpired({ loanId: '42' }, now)).toBe(true);
    expect(isPayloadExpired({ createdAt: 'вчера' }, now)).toBe(true);
  });
});

// Связка целиком: тот же префикс, что у storageKey, тот же предикат, что передаёт
// скрипт, и настоящий storagePrune ядра — с подменой GM_* (как в test/lib/agis-core.test.js).
describe('уборка хранилища: PAYLOAD_KEY_PREFIX + shouldPrunePayload + storagePrune ядра', () => {
  const { storagePrune } = require('../../lib/agis-core.js');
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
  });

  it('storageKey строится из PAYLOAD_KEY_PREFIX, префикс заканчивается на ":"', () => {
    expect(PAYLOAD_KEY_PREFIX.endsWith(':')).toBe(true);
    expect(storageKey('42')).toBe(`${PAYLOAD_KEY_PREFIX}42`);
  });

  it('удаляет просроченные и битые payload, не трогает свежие, соседнюю схему и debug', async () => {
    const now = Date.now();
    // Соседние ключи строятся из экспортированного префикса, а не литералами: если
    // SCRIPT_NS или версия схемы сменятся, тест продолжит проверять именно соседство.
    const neighbourSchemaKey = PAYLOAD_KEY_PREFIX.replace(/:$/, 'x:4'); // …:payload:v1x:4
    const debugKey = PAYLOAD_KEY_PREFIX.replace(/payload:v1:$/, 'debug'); // …:debug
    expect(neighbourSchemaKey.startsWith(PAYLOAD_KEY_PREFIX)).toBe(false);
    expect(debugKey.startsWith(PAYLOAD_KEY_PREFIX)).toBe(false);
    store.set(storageKey('1'), { loanId: '1', kopecks: 100, createdAt: now - 16 * 60 * 1000 });
    store.set(storageKey('2'), { loanId: '2', kopecks: 100, createdAt: now - 60_000 });
    store.set(storageKey('3'), null);
    store.set(neighbourSchemaKey, { createdAt: 0 });
    store.set(debugKey, true);

    const removed = await storagePrune(PAYLOAD_KEY_PREFIX, shouldPrunePayload);

    expect(removed).toBe(2);
    expect([...store.keys()].sort()).toEqual([debugKey, neighbourSchemaKey, storageKey('2')].sort());
  });

  it('shouldPrunePayload игнорирует второй аргумент (ключ), который передаёт storagePrune', () => {
    const fresh = { createdAt: Date.now() };
    // Ошибку «передали isPayloadExpired напрямую» ловит второй expect: ключ попал бы в
    // параметр now, now - createdAt дало бы NaN, а NaN > TTL — false, т.е. «не просрочен»
    // для заведомо старого payload — и уборка тихо перестала бы удалять что-либо.
    // Первый expect с этой ошибкой прошёл бы (тоже false) — он про то, что свежий не трогаем.
    expect(shouldPrunePayload(fresh, storageKey('2'))).toBe(false);
    expect(shouldPrunePayload({ createdAt: 0 }, storageKey('2'))).toBe(true);
  });
});
