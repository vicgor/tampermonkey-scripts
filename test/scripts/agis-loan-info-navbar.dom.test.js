// @vitest-environment jsdom
import { describe, it, beforeAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRowCell, getRowValue, parseDoc } from '../../scripts/agis-loan-info-navbar.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fixtures/agis-loan-edit.html — реальный (анонимизированный) кусок страницы AGIS
// /admin/agis2/core/loan/<id>/edit, см. комментарий в самом файле. Документ не мутируется
// тестируемыми функциями (getRowCell/getRowValue/parseDoc только читают DOM) — парсим один раз.
let doc;
beforeAll(() => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'agis-loan-edit.html'), 'utf8');
  doc = new DOMParser().parseFromString(html, 'text/html');
});

describe('getRowCell', () => {
  it('пропускает th без соседнего td (скрытая preview-таблица объединения транзакций)', () => {
    // В документе раньше "Основное" стоит decoy-таблица с <th>Дата</th> в thead без td —
    // getRowCell должен пройти мимо неё и вернуть td из блока "Основное".
    const cell = getRowCell(doc, /^Дата$/);
    expect(cell).not.toBeNull();
    expect(cell.textContent).toContain('Запрошен');
  });

  it('возвращает null, если совпадающий label вообще не найден', () => {
    expect(getRowCell(doc, /^Несуществующее поле$/)).toBeNull();
  });
});

describe('getRowValue', () => {
  it('firstTextOnly берёт только первый текстовый узел (до <br/>)', () => {
    expect(getRowValue(doc, /^Статус$/, { firstTextOnly: true })).toBe('Продан');
  });

  it('без firstTextOnly схлопывает весь textContent ячейки', () => {
    expect(getRowValue(doc, /^Прайслист$/)).toBe('RU COMMISSION 0.8% 1.3x');
  });
});

describe('parseDoc', () => {
  it('разбирает реальную страницу AGIS (fixtures/agis-loan-edit.html)', () => {
    expect(parseDoc(doc)).toEqual({
      body: '0,00 ₽ (Запрошено : 10 000,00 ₽)',
      total: '0,00 ₽',
      issuedOn: '25.02.25',
      dueDate: '27.03.25',
      totalTerm: '30 дней ( 1 месяц 2 дня )',
      overdueDays: '2 дня',
      priceList: 'RU COMMISSION 0.8% 1.3x',
      loanType: 'PayDay',
      status: 'Продан',
    });
  });

  it('overdueDays не захватывает следующее поле "Дата возврата:"', () => {
    // Регрессионный тест на фикс: extractValue(dc, 'Просрочен на:', /$/) раньше
    // не останавливался перед "Дата возврата:" и захватывал её целиком в overdueDays.
    expect(parseDoc(doc).overdueDays).toBe('2 дня');
    expect(parseDoc(doc).overdueDays).not.toContain('Дата возврата');
  });
});
