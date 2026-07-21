// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeaderMap } from '../../scripts/agis-protocol-income-fill.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fixtures/agis-task-protocol-list.html — реальный кусок страницы AGIS
// /admin/supportprocess/domain/supportprocesstask/<id>/task-protocol/list, см. комментарий
// в самом файле.
function loadFixtureTable() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'agis-task-protocol-list.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('table');
}

describe('getHeaderMap', () => {
  it('находит индексы колонок loanId/amount/incomeDate по реальным заголовкам AGIS', () => {
    expect(getHeaderMap(loadFixtureTable())).toEqual({ loanId: 3, amount: 8, incomeDate: 9 });
  });

  it('orderNumber отсутствует — на этой реальной странице нет колонки "Номер заказа"', () => {
    // Не артефакт фикстуры: настоящая страница списка протокола не имеет такой колонки
    // вообще, поэтому colIndex.orderNumber всегда undefined здесь (см. ROADMAP.md) —
    // вызывающий код (initListPage) уже учитывает это через `!== undefined` проверку
    // и подставляет '-'.
    expect(getHeaderMap(loadFixtureTable()).orderNumber).toBeUndefined();
  });
});
