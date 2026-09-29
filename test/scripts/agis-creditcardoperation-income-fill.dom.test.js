// @vitest-environment jsdom
import { describe, it, beforeAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getHeaderMap,
  extractOperation,
  isIncomingOperation,
  resolveIncomeType,
} from '../../scripts/agis-creditcardoperation-income-fill.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fixtures/agis-creditcardoperation-list.html — реальная таблица страницы
// /admin/agis2/core/loan-overdue/<id>/creditcardoperation/list (creditsmile, обезличена), см. комментарий
// в самом файле. Тесты только читают DOM — парсим один раз.
let table;
let colIndex;
let operations;
beforeAll(() => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'fixtures', 'agis-creditcardoperation-list.html'),
    'utf8',
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  table = doc.querySelector('table.sonata-ba-list');
  colIndex = getHeaderMap(table);
  operations = Array.from(table.querySelectorAll('tbody tr')).map((tr) => extractOperation(tr.children, colIndex));
});

describe('getHeaderMap', () => {
  it('находит индексы колонок по реальным заголовкам (в т.ч. обёрнутым в <a> сортировки)', () => {
    expect(colIndex).toEqual({
      amount: 1,
      orderReference: 3,
      operationType: 5,
      status: 6,
      processedAt: 8,
      gateway: 9,
    });
  });
});

describe('extractOperation', () => {
  it('разбирает входящую операцию в данные для формы прихода', () => {
    expect(operations[1]).toEqual({
      operationType: 'repayment',
      incomeDate: '2026-08-12 10:20:21',
      amount: '1234.00',
      orderReference: 'L-99999999-IN-00000000000002',
      gateway: 'siab_bank',
      status: 'PROCESSING',
    });
  });

  it('берёт время из текста <time> (пояс админки), а не UTC из datetime-атрибута', () => {
    expect(operations[3].incomeDate).toBe('2026-09-04 06:40:41');
  });

  it('кликабельны только 3 входящие строки из 4 — выдача (money_transfer) пропускается', () => {
    expect(operations.map((o) => isIncomingOperation(o.operationType))).toEqual([false, true, true, true]);
  });

  it('шлюз каждой входящей операции сопоставлен опции manualIncomeType', () => {
    const incoming = operations.filter((o) => isIncomingOperation(o.operationType));
    expect(incoming.map((o) => resolveIncomeType(o.gateway))).toEqual(['MI_Siab', 'MI_Siab', 'MI_Siab']);
  });
});
