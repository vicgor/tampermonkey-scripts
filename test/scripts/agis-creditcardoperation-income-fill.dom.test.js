// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getHeaderMap } from '../../scripts/agis-creditcardoperation-income-fill.user.js';

// Заголовки — со страницы /admin/agis2/core/loan-overdue/<id>/creditcardoperation/list
// (creditsmile), порядок колонок сохранён. Реальной HTML-фикстуры пока нет.
const HEADERS = [
  'ID',
  'Сумма',
  'Счет получателя',
  'Номер операции',
  'Номер в банке',
  'Тип',
  'Статус',
  'Причина',
  'Дата',
  'Платежный шлюз',
  'Переопросить',
];

function buildTable(headers) {
  const table = document.createElement('table');
  const row = table.createTHead().insertRow();
  headers.forEach((text) => {
    const th = document.createElement('th');
    th.textContent = `\n    ${text}\n  `;
    row.appendChild(th);
  });
  return table;
}

describe('getHeaderMap', () => {
  it('находит индексы колонок по заголовкам списка операций', () => {
    expect(getHeaderMap(buildTable(HEADERS))).toEqual({
      amount: 1,
      orderReference: 3,
      operationType: 5,
      status: 6,
      processedAt: 8,
      gateway: 9,
    });
  });

  it('не путает "Номер в банке" с "Номер операции"', () => {
    expect(getHeaderMap(buildTable(['Номер в банке'])).orderReference).toBeUndefined();
  });
});
