// @vitest-environment jsdom
import { describe, it, beforeAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMANDS,
  isListRoute,
  buildFilterUrl,
  findExecutePath,
  parseTaskForm,
  buildFormBody,
  classifyLaunchResponse,
} from '../../scripts/agis-bankrupt-write-off.user.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', name), 'utf8');
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

let listHtml;
let formHtml;
beforeAll(() => {
  listHtml = readFixture('agis-supportprocess-list.html');
  formHtml = readFixture('agis-supportprocesstask-create.html');
});

describe('COMMANDS', () => {
  it('три команды в порядке: перевод → подтверждение → списание', () => {
    expect(COMMANDS).toEqual([
      'agis2:bankruptcy:move-to-in-process-bankruptcy',
      'agis2:bankruptcy:confirmation-bankruptcy',
      'agis2:written-off:write-off-bankrupt-loans',
    ]);
  });
});

describe('isListRoute', () => {
  it('только список команд, со слешем на конце или без', () => {
    expect(isListRoute('/admin/supportprocess/domain/supportprocess/list')).toBe(true);
    expect(isListRoute('/admin/supportprocess/domain/supportprocess/list/')).toBe(true);
    expect(isListRoute('/admin/supportprocess/domain/supportprocess/33/supportprocesstask/create')).toBe(false);
    expect(isListRoute('/admin/supportprocess/domain/supportprocesstask/list')).toBe(false);
  });
});

describe('buildFilterUrl', () => {
  it('кодирует имя команды в filter[name][value]', () => {
    const url = new URL(buildFilterUrl('https://agis.creditsmile.ru', 'agis2:bankruptcy:confirmation-bankruptcy'));
    expect(url.origin + url.pathname).toBe(
      'https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocess/list',
    );
    expect(url.searchParams.get('filter[name][value]')).toBe('agis2:bankruptcy:confirmation-bankruptcy');
  });
});

describe('findExecutePath', () => {
  it('находит Execute каждой команды по точному имени среди совпадений подстроки', () => {
    const doc = parse(listHtml);
    expect(findExecutePath(doc, COMMANDS[0])).toEqual({
      path: '/admin/supportprocess/domain/supportprocess/33/supportprocesstask/create',
    });
    expect(findExecutePath(doc, COMMANDS[1]).path).toBe(
      '/admin/supportprocess/domain/supportprocess/32/supportprocesstask/create',
    );
    expect(findExecutePath(doc, COMMANDS[2]).path).toBe(
      '/admin/supportprocess/domain/supportprocess/44/supportprocesstask/create',
    );
  });

  it('частичное имя не совпадает', () => {
    expect(findExecutePath(parse(listHtml), 'agis2:bankruptcy').error).toMatch(/не найдена/);
  });

  it('нет кнопки Execute — ошибка, а не ссылка «Редактировать»', () => {
    const doc = parse(listHtml);
    doc.querySelector('a[href$="/33/supportprocesstask/create"]').remove();
    expect(findExecutePath(doc, COMMANDS[0]).error).toMatch(/нет кнопки Execute/);
  });

  it('две строки с одинаковым именем — ошибка', () => {
    const doc = parse(listHtml);
    const row = doc.querySelector('td[objectid="33"]').closest('tr');
    row.after(row.cloneNode(true));
    expect(findExecutePath(doc, COMMANDS[0]).error).toMatch(/2 раза/);
  });
});

describe('parseTaskForm', () => {
  it('собирает CSRF-токен и кнопку «Создать и вернуться к списку»', () => {
    const form = parseTaskForm(parse(formHtml), COMMANDS[0]);
    expect(form).toEqual({
      action: '/admin/supportprocess/domain/supportprocess/33/supportprocesstask/create?uniqid=s6af464e345ae7',
      fields: [
        ['s6af464e345ae7[_token]', 'test-csrf-token'],
        ['btn_create_and_list', ''],
      ],
    });
    expect(buildFormBody(form.fields)).toBe('s6af464e345ae7%5B_token%5D=test-csrf-token&btn_create_and_list=');
  });

  it('форма другой команды — ошибка', () => {
    expect(parseTaskForm(parse(formHtml), COMMANDS[2]).error).toMatch(/другой команде/);
  });

  it('у команды появились параметры — ошибка', () => {
    const doc = parse(formHtml);
    const input = doc.createElement('input');
    input.type = 'text';
    input.name = 's6af464e345ae7[loanId]';
    doc.querySelector('.box-body').append(input);
    expect(parseTaskForm(doc, COMMANDS[0]).error).toMatch(/параметры \(s6af464e345ae7\[loanId\]\)/);
  });

  it('нет CSRF-токена — ошибка', () => {
    const doc = parse(formHtml);
    doc.querySelector('input[type="hidden"]').remove();
    expect(parseTaskForm(doc, COMMANDS[0]).error).toMatch(/CSRF/);
  });

  it('страница без формы (например, вход) — ошибка', () => {
    expect(parseTaskForm(parse('<form action="/admin/login_check"></form>'), COMMANDS[0]).error).toMatch(/не найдена/);
  });
});

describe('classifyLaunchResponse', () => {
  const ok = (finalUrl, html = '') => classifyLaunchResponse({ status: 200, finalUrl, doc: parse(html) });

  it('редирект с формы — задача создана', () => {
    expect(
      ok('https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocess/33/supportprocesstask/list'),
    ).toEqual({ ok: true, path: '/admin/supportprocess/domain/supportprocess/33/supportprocesstask/list' });
  });

  it('вернулась форма создания — не создана, текст ошибки из плашки', () => {
    const result = ok(
      'https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocess/33/supportprocesstask/create?uniqid=x',
      '<div class="alert alert-danger">Неверный CSRF-токен</div>',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Неверный CSRF-токен/);
  });

  it('зелёная плашка — успех, даже если URL не сменился', () => {
    expect(
      ok(
        'https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocess/33/supportprocesstask/create',
        '<div class="alert alert-success">Элемент создан</div>',
      ).ok,
    ).toBe(true);
  });

  it('страница входа и HTTP-ошибка — не успех', () => {
    expect(ok('https://agis.creditsmile.ru/admin/login').error).toMatch(/сессия/);
    expect(
      classifyLaunchResponse({ status: 500, finalUrl: 'https://agis.creditsmile.ru/x', doc: parse('') }).error,
    ).toBe('HTTP 500');
  });
});
