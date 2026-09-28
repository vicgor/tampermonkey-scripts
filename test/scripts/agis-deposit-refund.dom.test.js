// @vitest-environment jsdom
import { describe, it, beforeAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDepositFromDefinitionList, findDepositIn } from '../../scripts/agis-deposit-refund.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fixtures/agis-loan-edit.html — карточка займа без «ДС на счету», депозит только в
// <dt>Депозит</dt><dd>0,00 ₽</dd> блока «Сумма».
let fixtureHtml;
beforeAll(() => {
  fixtureHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'agis-loan-edit.html'), 'utf8');
});

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

describe('extractDepositFromDefinitionList', () => {
  it('находит «Депозит» в реальной разметке карточки займа', () => {
    const result = extractDepositFromDefinitionList(parse(fixtureHtml).body);
    expect(result).toEqual({ kopecks: 0, sourceText: 'Депозит: 0,00 ₽' });
  });

  it('разбирает ненулевой депозит (как на volgazaim)', () => {
    const doc = parse(
      '<dl><dt style="display:none">Фикс. штраф</dt><dd>0,00 ₽</dd>' +
        '<dt style="white-space: normal;"> Депозит </dt><dd>2 800,00 ₽</dd>' +
        '<dt>Итого на сегодня</dt><dd>0,00 ₽</dd></dl>',
    );
    expect(extractDepositFromDefinitionList(doc.body).kopecks).toBe(280000);
  });

  it('не путает с «Возврат депозита» и dt без dd', () => {
    const doc = parse('<dl><dt>Возврат депозита</dt><dd>100,00 ₽</dd><dt>Депозит</dt></dl>');
    expect(extractDepositFromDefinitionList(doc.body)).toBeNull();
  });
});

describe('findDepositIn', () => {
  it('предпочитает «ДС на счету», если он есть', () => {
    const doc = parse('<p>ДС на счету: 500,00 ₽</p><dl><dt>Депозит</dt><dd>2 800,00 ₽</dd></dl>');
    expect(findDepositIn(doc.body).kopecks).toBe(50000);
  });

  it('падает на «Депозит», если «ДС на счету» нет', () => {
    const doc = parse('<dl><dt>Депозит</dt><dd>2 800,00 ₽</dd></dl>');
    expect(findDepositIn(doc.body).kopecks).toBe(280000);
  });

  it('возвращает null без корня и без меток', () => {
    expect(findDepositIn(null)).toBeNull();
    expect(findDepositIn(parse('<p>Итого: 1,00 ₽</p>').body)).toBeNull();
  });
});
