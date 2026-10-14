// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  parseRoute,
  detectDelimiter,
  tokenizeCSV,
  parseQueue,
  toCloseDateTime,
  findOption,
  findForceCloseTransition,
  isDone,
  progressOf,
  pickNext,
  isPendingUsable,
  selectTransition,
  looksLikeHtml,
  fillCloseFields,
  isForceCloseSubmission,
  detectCloseResult,
} from '../../scripts/agis-loan-force-close.user.js';

// 09:34:56 UTC = 12:34:56 по Москве (UTC+3) — тесты не зависят от пояса машины.
const NOW = new Date(Date.UTC(2026, 9, 14, 9, 34, 56));

describe('parseRoute', () => {
  it('разбирает страницу редактирования займа', () => {
    expect(parseRoute('/admin/agis2/core/loan/130001/edit')).toEqual({ section: 'loan', loanId: '130001' });
  });
  it('сохраняет раздел админки', () => {
    expect(parseRoute('/admin/agis2/core/loan-overdue/5/edit/')).toEqual({ section: 'loan-overdue', loanId: '5' });
  });
  it('другие страницы — null', () => {
    expect(parseRoute('/admin/agis2/core/loan/5/show')).toBeNull();
    expect(parseRoute('/admin/agis2/core/loan/list')).toBeNull();
  });
});

describe('CSV', () => {
  it('определяет разделитель по заголовку', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a\tb')).toBe('\t');
  });
  it('понимает кавычки и переводы строк внутри поля', () => {
    expect(tokenizeCSV('a,"b,""c""\nd"\n1,2')).toEqual([
      ['a', 'b,"c"\nd'],
      ['1', '2'],
    ]);
  });
});

describe('parseQueue', () => {
  const header = 'loanid,reason,date,comment';

  it('разбирает строки, BOM и регистр заголовков', () => {
    const { items, errors } = parseQueue(
      '﻿LoanID;Reason;Date;Comment\n130001;fraud_loan_taken_other_person;13.10.2026;Мошенничество RUSUPPORT-75272',
    );
    expect(errors).toEqual([]);
    expect(items).toEqual([
      {
        loanId: '130001',
        reason: 'fraud_loan_taken_other_person',
        date: '13.10.2026',
        comment: 'Мошенничество RUSUPPORT-75272',
      },
    ]);
  });

  it('принимает русские заголовки', () => {
    const { items } = parseQueue('Номер займа,Причина,Дата,Комментарий\n1,fraud,13.10.2026,c', NOW);
    expect(items).toHaveLength(1);
  });

  it('пропускает пустые строки', () => {
    const { items, errors } = parseQueue(`${header}\n,,,\n1,r,13.10.2026,c\n`, NOW);
    expect(items).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('отклоняет плохие строки с номером строки и не кладёт их в очередь', () => {
    const { items, errors } = parseQueue(
      [
        header,
        'abc,r,13.10.2026,c',
        '2,,13.10.2026,c',
        '3,r,13.10.2026,',
        '4,r,31.02.2026,c',
        '5,r,13.10.2026,ok',
        '6,r,15.10.2026,будущая',
      ].join('\n'),
      NOW,
    );
    expect(items.map((i) => i.loanId)).toEqual(['5']);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toContain('строка 2');
    expect(errors[4]).toContain('займ 6');
  });

  it('отбрасывает дубли займов', () => {
    const { items, errors } = parseQueue(`${header}\n1,r,13.10.2026,c\n1,r,13.10.2026,c`, NOW);
    expect(items).toHaveLength(1);
    expect(errors[0]).toContain('уже есть');
  });

  it('ошибка, если нет нужных колонок', () => {
    const { items, errors } = parseQueue('loanid,reason\n1,r');
    expect(items).toEqual([]);
    expect(errors[0]).toContain('date');
  });

  it('пустая таблица — ошибка', () => {
    expect(parseQueue('').errors).toHaveLength(1);
  });
});

describe('toCloseDateTime', () => {
  it('подставляет текущее время к дате из таблицы', () => {
    expect(toCloseDateTime('13.10.2026', NOW)).toBe('2026-10-13 12:34:56');
    expect(toCloseDateTime('2026-10-13', NOW)).toBe('2026-10-13 12:34:56');
  });
  it('сегодняшняя дата допустима', () => {
    expect(toCloseDateTime('14.10.2026', NOW)).toBe('2026-10-14 12:34:56');
  });
  it('будущая дата — null', () => {
    expect(toCloseDateTime('15.10.2026', NOW)).toBeNull();
  });
  it('время и «сегодня» — по Москве, а не по поясу браузера', () => {
    // 22:30 UTC 14.10 — в Москве уже 01:30 15.10: 15-е допустимо, время московское.
    const lateUtc = new Date(Date.UTC(2026, 9, 14, 22, 30, 0));
    expect(toCloseDateTime('15.10.2026', lateUtc)).toBe('2026-10-15 01:30:00');
    // Оператор в UTC+7: у него уже 15-е, а в Москве ещё 14-е — 15-е отклоняем.
    const novosibirskMorning = new Date(Date.UTC(2026, 9, 14, 17, 30, 0));
    expect(toCloseDateTime('15.10.2026', novosibirskMorning)).toBeNull();
    expect(toCloseDateTime('14.10.2026', novosibirskMorning)).toBe('2026-10-14 20:30:00');
  });
  it('несуществующая и мусорная дата — null', () => {
    expect(toCloseDateTime('31.02.2026', NOW)).toBeNull();
    expect(toCloseDateTime('вчера', NOW)).toBeNull();
    expect(toCloseDateTime('', NOW)).toBeNull();
  });
});

describe('findOption', () => {
  const options = [
    { value: '', text: '' },
    { value: 'forgiveness', text: 'Прощение' },
    { value: 'fraud_loan_taken_other_person', text: 'Мошенничество - Заем взят на другое лицо' },
    { value: 'fraud_loan_taken_yourself_without_right', text: 'Мошенничество - Заем взят на себя без права' },
  ];
  it('точное совпадение по значению', () => {
    expect(findOption(options, 'fraud_loan_taken_other_person').option.value).toBe('fraud_loan_taken_other_person');
  });
  it('точное совпадение по тексту без учёта регистра', () => {
    expect(findOption(options, 'прощение').option.value).toBe('forgiveness');
  });
  it('полный текст причины с лишними пробелами', () => {
    expect(findOption(options, '  Мошенничество  -  Заем взят на другое лицо ').option.value).toBe(
      'fraud_loan_taken_other_person',
    );
  });
  it('частичное совпадение не принимается, даже единственное', () => {
    expect(findOption(options, 'другое лицо')).toEqual({ option: null, reason: 'none' });
    expect(findOption(options, 'Мошенничество')).toEqual({ option: null, reason: 'none' });
  });
  it('дубли текста в списке — неоднозначно', () => {
    const dup = [...options, { value: 'forgiveness_2', text: 'Прощение' }];
    expect(findOption(dup, 'Прощение')).toEqual({ option: null, reason: 'ambiguous' });
  });
  it('нет совпадений / пусто', () => {
    expect(findOption(options, 'смерть').reason).toBe('none');
    expect(findOption(options, '').reason).toBe('empty');
  });
});

describe('findForceCloseTransition', () => {
  it('по значению 26', () => {
    expect(
      findForceCloseTransition([
        { value: '52', text: 'Каникулы' },
        { value: '26', text: 'x' },
      ]).value,
    ).toBe('26');
  });
  it('по тексту', () => {
    expect(findForceCloseTransition([{ value: '99', text: 'Принудительное закрытие' }]).value).toBe('99');
  });
  it('нет перехода — null', () => {
    expect(findForceCloseTransition([{ value: '52', text: 'Каникулы' }])).toBeNull();
  });
});

describe('очередь и прогресс', () => {
  const items = [
    { loanId: '1', comment: 'c' },
    { loanId: '2', comment: 'c' },
    { loanId: '3', comment: 'c' },
  ];
  const done = { 1: { at: 1, comment: 'c' }, 3: { at: 1, comment: 'old' } };

  it('isDone учитывает комментарий (другая задача — не выполнено)', () => {
    expect(isDone(done, items[0])).toBe(true);
    expect(isDone(done, items[2])).toBe(false);
  });
  it('progressOf', () => {
    expect(progressOf(items, done)).toEqual({ total: 3, done: 1, left: 2 });
  });
  it('pickNext идёт вперёд по порядку, затем с начала', () => {
    expect(pickNext(items, done, '2').loanId).toBe('3');
    expect(pickNext(items, done, '3').loanId).toBe('2');
    expect(pickNext(items, { 1: done[1], 2: { at: 1, comment: 'c' }, 3: { at: 1, comment: 'c' } }, '1')).toBeNull();
  });
  it('isPendingUsable: только отправленная форма своего займа и не старше TTL', () => {
    const sent = { stage: 'submitted', loanId: '1', submittedAt: 1000 };
    expect(isPendingUsable(sent, '1', 2000)).toBe(true);
    expect(isPendingUsable({ ...sent, loanId: '2' }, '1', 2000)).toBe(false);
    expect(isPendingUsable({ ...sent, stage: 'filled' }, '1', 2000)).toBe(false);
    expect(isPendingUsable(sent, '1', 1000 + 11 * 60 * 1000)).toBe(false);
    expect(isPendingUsable(null, '1')).toBe(false);
  });
});

describe('looksLikeHtml', () => {
  it('страница входа Google вместо CSV', () => {
    expect(looksLikeHtml('\n  <!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('loanid,reason,date,comment')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
  });
});

describe('форма закрытия (jsdom)', () => {
  const formHtml = `
    <form>
      <select class="transition_select">
        <option value="">—</option><option value="52">Каникулы</option><option value="26">Принудительное закрытие</option>
      </select>
      <select class="force_close_reason">
        <option value="">—</option>
        <option value="forgiveness">Прощение</option>
        <option value="fraud_loan_taken_other_person">Мошенничество - Заем взят на другое лицо</option>
        <option value="fraud_loan_taken_yourself_without_right">Мошенничество - Заем взят на себя без права</option>
      </select>
      <input class="close_date" value="">
      <input class="force_close_comment" value="">
      <input type="checkbox" class="change_status_checkbox_sms" checked>
    </form>`;
  const setup = () => {
    document.body.innerHTML = formHtml;
    return document;
  };

  it('выбирает переход принудительного закрытия', () => {
    const doc = setup();
    const result = selectTransition(doc);
    expect(result.ok).toBe(true);
    expect(doc.querySelector('.transition_select').value).toBe('26');
  });

  it('сообщает, если перехода нет', () => {
    document.body.innerHTML = '<select class="transition_select"><option value="52">Каникулы</option></select>';
    expect(selectTransition(document).ok).toBe(false);
  });

  it('заполняет причину, дату, комментарий и снимает СМС', () => {
    const doc = setup();
    const { problems } = fillCloseFields(doc, {
      reason: 'fraud_loan_taken_other_person',
      closeDateTime: '2026-10-13 12:34:56',
      comment: 'Мошенничество RUSUPPORT-75272',
    });
    expect(problems).toEqual([]);
    expect(doc.querySelector('.force_close_reason').value).toBe('fraud_loan_taken_other_person');
    expect(doc.querySelector('.close_date').value).toBe('2026-10-13 12:34:56');
    expect(doc.querySelector('.force_close_comment').value).toBe('Мошенничество RUSUPPORT-75272');
    expect(doc.querySelector('.change_status_checkbox_sms').checked).toBe(false);
  });

  it('неоднозначная причина — проблема, причина не выбрана', () => {
    const doc = setup();
    const { problems } = fillCloseFields(doc, { reason: 'Мошенничество', closeDateTime: 'x', comment: 'c' });
    expect(problems).toHaveLength(1);
    expect(doc.querySelector('.force_close_reason').value).toBe('');
  });

  it('отсутствующие поля (включая чекбокс СМС) попадают в problems', () => {
    document.body.innerHTML = '<form></form>';
    const { problems } = fillCloseFields(document, { reason: 'r', closeDateTime: 'x', comment: 'c' });
    expect(problems).toHaveLength(4);
    expect(problems[3]).toContain('СМС');
  });

  it('нет только чекбокса СМС — проблема, а не молчаливый пропуск', () => {
    const doc = setup();
    doc.querySelector('.change_status_checkbox_sms').remove();
    const { problems } = fillCloseFields(doc, {
      reason: 'forgiveness',
      closeDateTime: '2026-10-13 12:34:56',
      comment: 'c',
    });
    expect(problems).toEqual([expect.stringContaining('СМС')]);
  });

  it('datetime-local: значение в формате с T', () => {
    const doc = setup();
    doc.querySelector('.close_date').type = 'datetime-local';
    const { problems } = fillCloseFields(doc, {
      reason: 'forgiveness',
      closeDateTime: '2026-10-13 12:34:56',
      comment: 'c',
    });
    expect(problems).toEqual([]);
    expect(doc.querySelector('.close_date').value).toMatch(/^2026-10-13T12:34:56/);
  });

  it('поле даты не приняло значение — проблема', () => {
    const doc = setup();
    doc.querySelector('.close_date').type = 'date';
    const { problems } = fillCloseFields(doc, {
      reason: 'forgiveness',
      closeDateTime: '2026-10-13 12:34:56',
      comment: 'c',
    });
    expect(problems).toEqual([expect.stringContaining('даты закрытия не приняло')]);
  });

  it('isForceCloseSubmission: наш переход и наша причина', () => {
    const doc = setup();
    selectTransition(doc);
    fillCloseFields(doc, { reason: 'forgiveness', closeDateTime: '2026-10-13 12:34:56', comment: 'c' });
    expect(isForceCloseSubmission(doc, 'forgiveness')).toBe(true);
    doc.querySelector('.force_close_reason').value = 'fraud_loan_taken_other_person';
    expect(isForceCloseSubmission(doc, 'forgiveness')).toBe(false);
    doc.querySelector('.force_close_reason').value = 'forgiveness';
    doc.querySelector('.transition_select').value = '52';
    expect(isForceCloseSubmission(doc, 'forgiveness')).toBe(false);
  });

  it('detectCloseResult: закрыто только при зелёной плашке и исчезнувшем переходе', () => {
    document.body.innerHTML = '';
    expect(detectCloseResult(document)).toBeNull();

    document.body.innerHTML = '<div class="alert alert-danger">err</div>';
    expect(detectCloseResult(document)).toBe('error');

    // Сохранили карточку другим действием — плашка есть, но закрытие по-прежнему доступно.
    document.body.innerHTML = `<div class="alert alert-success">ok</div>${formHtml}`;
    expect(detectCloseResult(document)).toBe('unconfirmed');

    document.body.innerHTML =
      '<div class="alert alert-success">ok</div>' +
      '<select class="transition_select"><option value="">—</option><option value="52">Каникулы</option></select>';
    expect(detectCloseResult(document)).toBe('closed');
  });
});
