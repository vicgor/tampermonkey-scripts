// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRowCell, getRowValue, parseDoc } from '../../scripts/agis-loan-info-navbar.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fixtures/agis-loan-edit.html — реальный (анонимизированный) кусок страницы AGIS
// /admin/agis2/core/loan/<id>/edit, см. комментарий в самом файле.
function loadFixtureDoc() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'agis-loan-edit.html'), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('getRowCell', () => {
  it('пропускает th без соседнего td (скрытая preview-таблица объединения транзакций)', () => {
    // В документе раньше "Основное" стоит decoy-таблица с <th>Дата</th> в thead без td —
    // getRowCell должен пройти мимо неё и вернуть td из блока "Основное".
    const doc = loadFixtureDoc();
    const cell = getRowCell(doc, /^Дата$/);
    expect(cell).not.toBeNull();
    expect(cell.textContent).toContain('Запрошен');
  });

  it('возвращает null, если совпадающий label вообще не найден', () => {
    const doc = loadFixtureDoc();
    expect(getRowCell(doc, /^Несуществующее поле$/)).toBeNull();
  });
});

describe('getRowValue', () => {
  it('firstTextOnly берёт только первый текстовый узел (до <br/>)', () => {
    const doc = loadFixtureDoc();
    expect(getRowValue(doc, /^Статус$/, { firstTextOnly: true })).toBe('Продан');
  });

  it('без firstTextOnly схлопывает весь textContent ячейки', () => {
    const doc = loadFixtureDoc();
    expect(getRowValue(doc, /^Прайслист$/)).toBe('RU COMMISSION 0.8% 1.3x');
  });
});

describe('parseDoc', () => {
  it('разбирает реальную страницу AGIS (fixtures/agis-loan-edit.html)', () => {
    const doc = loadFixtureDoc();
    expect(parseDoc(doc)).toEqual({
      body: '0,00 ₽ (Запрошено : 10 000,00 ₽)',
      total: '0,00 ₽',
      issuedOn: '25.02.25',
      dueDate: '27.03.25',
      totalTerm: '30 дней ( 1 месяц 2 дня )',
      // Известное поведение: extractValue(dc, 'Просрочен на:', /$/) не останавливается перед
      // "Дата возврата:" (стоп-регексп — только конец строки), поэтому оно попадает в overdueDays
      // вместе с датой возврата. Реальный баг парсинга, не артефакт фикстуры — см. ROADMAP.md.
      overdueDays: '2 дня Дата возврата: 14 мар. 2025 г.',
      priceList: 'RU COMMISSION 0.8% 1.3x',
      loanType: 'PayDay',
      status: 'Продан',
    });
  });
});
