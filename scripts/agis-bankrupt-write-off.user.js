// ==UserScript==
// @name         AGIS - списание банкротов (3 команды подряд)
// @namespace    agis.bankrupt.write-off
// @version      1.0.0
// @description  На странице «Список команд» кнопка «Списание банкротов»: после подтверждения по очереди запускает agis2:bankruptcy:move-to-in-process-bankruptcy, agis2:bankruptcy:confirmation-bankruptcy и agis2:written-off:write-off-bankrupt-loans. Окончания команд не ждёт.
// @match        https://agis.creditsmile.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.belkacredit.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.volgazaim.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.berrycash.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.moneymania.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.credit7.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.credit365.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.vashcash.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.ikracredit.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.zaimix.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.finrook.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.mkksmev.ru/admin/supportprocess/domain/supportprocess/list*
// @match        https://agis.nadodeneg.ru/admin/supportprocess/domain/supportprocess/list*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-bankrupt-write-off.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-bankrupt-write-off.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.5.0/lib/agis-core.js#sha256=NtCeXh37/rYT8WTTGPWsFqdhtzdTaYL+KRcM7XeqOaE=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      agis.creditsmile.ru
// @connect      agis.belkacredit.ru
// @connect      agis.volgazaim.ru
// @connect      agis.berrycash.ru
// @connect      agis.moneymania.ru
// @connect      agis.credit7.ru
// @connect      agis.credit365.ru
// @connect      agis.vashcash.ru
// @connect      agis.ikracredit.ru
// @connect      agis.zaimix.ru
// @connect      agis.finrook.ru
// @connect      agis.mkksmev.ru
// @connect      agis.nadodeneg.ru
// ==/UserScript==

// @run-at document-start — как во всех скриптах проекта: onUrlChange ставится до старта страницы,
// а кнопка всё равно добавляется только после waitForElement (document-start ≠ готовый DOM).
//
// Как AGIS запускает команду (проверено на creditsmile): в строке списка кнопка Execute ведёт на
// GET /admin/supportprocess/domain/supportprocess/<id>/supportprocesstask/create — форма без полей,
// только CSRF-токен; POST этой формы с btn_create_and_list создаёт задачу и редиректит обратно.
// id команд на брендах разные, поэтому путь каждый раз берётся из отфильтрованного списка.
// Скрипт повторяет ровно эти два запроса через GM_xmlhttpRequest (с cookies сессии оператора).

(() => {
  'use strict';

  // Порядок важен: перевод в «в процессе банкротства» → подтверждение → списание.
  const COMMANDS = [
    'agis2:bankruptcy:move-to-in-process-bankruptcy',
    'agis2:bankruptcy:confirmation-bankruptcy',
    'agis2:written-off:write-off-bankrupt-loans',
  ];
  const LIST_PATH = '/admin/supportprocess/domain/supportprocess/list';
  const EXECUTE_PATH_RE = /^\/admin\/supportprocess\/domain\/supportprocess\/\d+\/supportprocesstask\/create\/?$/;
  const CREATE_PATH_RE = /\/supportprocesstask\/create\/?$/;
  const LOGIN_PATH_RE = /\/login\/?$/;
  const SUBMIT_NAME = 'btn_create_and_list';
  // Повторный запуск в течение получаса — с дополнительным предупреждением в confirm.
  const REPEAT_WARN_MS = 30 * 60 * 1000;

  // normalizeText приходит из ядра (window.__AGIS_CORE__) — либо из require() в Node-ветке теста.
  let normalizeText;

  // Тестовый экспорт для vitest (test/scripts/agis-bankrupt-write-off.test.js) — до window-guard'а,
  // т.к. в Node window не определён. В Tampermonkey process/module не определены — ветка мёртвая.
  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    normalizeText = require('../lib/agis-core.js').normalizeText;
    module.exports = {
      COMMANDS,
      isListRoute,
      buildFilterUrl,
      findExecutePath,
      parseTaskForm,
      buildFormBody,
      classifyLaunchResponse,
    };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:bankrupt-write-off] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForElement,
    cleanupRoute,
    cleanup,
    onUrlChange,
    createRouteTokenController,
    registerDebugToggle,
    storageGet,
    storageSet,
    httpRequest,
    api,
    showBanner,
    debounce,
  } = window.__AGIS_CORE__;
  normalizeText = window.__AGIS_CORE__.normalizeText;

  const SCRIPT_NS = 'agis:bankrupt-write-off';
  const DOM_NS = 'agis-bankrupt-write-off'; // без двоеточия — для id
  const BUTTON_ID = `${DOM_NS}-button`;
  // Хранилище общее для всех @match-доменов — время последнего запуска храним по хосту.
  const LAST_RUN_KEY = `${SCRIPT_NS}:last-run:v1:${location.host}`;
  const DEBUG_KEY = `${SCRIPT_NS}:debug`;
  const WAIT_TIMEOUT = 15000;

  // registerDebugToggle асинхронный — до резолва debugCtl.value всегда false, поэтому его await'им
  // перед первым bootstrap() (см. низ файла).
  let debugCtl = { value: false };
  const log = (...a) => {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a);
  };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}][${location.host}]`, ...a);

  const routeTokenController = createRouteTokenController();
  let running = false;

  // --- Чистые функции (экспортируются в тесты) ------------------------------

  function isListRoute(pathname) {
    return String(pathname || '').replace(/\/+$/, '') === LIST_PATH;
  }

  function buildFilterUrl(origin, name) {
    const url = new URL(LIST_PATH, origin);
    url.searchParams.set('filter[name][value]', name);
    return url.href;
  }

  // Фильтр Sonata ищет подстроку («bankrupt» находит 4 команды, в т.ч. fill-extrajudicial-…), поэтому
  // строку берём только по точному имени. Ломкое место: имя — первый <p> ячейки «Имя».
  function findExecutePath(doc, name) {
    const paths = [];
    let named = 0;
    for (const row of doc.querySelectorAll('table.sonata-ba-list tbody tr')) {
      if (normalizeText(row.querySelector('td.sonata-ba-list-field-string p')?.textContent) !== name) continue;
      named += 1;
      const link = Array.from(row.querySelectorAll('a[href]')).find((a) =>
        EXECUTE_PATH_RE.test(a.getAttribute('href')),
      );
      if (link) paths.push(link.getAttribute('href'));
    }
    if (paths.length === 1) return { path: paths[0] };
    if (named === 0) return { error: `команда ${name} не найдена в списке` };
    if (paths.length === 0) return { error: `у команды ${name} нет кнопки Execute` };
    return { error: `команда ${name} найдена ${paths.length} раза — непонятно, какую запускать` };
  }

  // Форма запуска: проверяем, что она той самой команды и без параметров (заполнять их вслепую
  // нельзя), и собираем hidden-поля (CSRF-токен) + кнопку «Создать и вернуться к списку».
  function parseTaskForm(doc, name) {
    const form = Array.from(doc.querySelectorAll('form')).find((f) =>
      CREATE_PATH_RE.test((f.getAttribute('action') || '').split('?')[0]),
    );
    if (!form) return { error: `форма запуска ${name} не найдена` };

    const title = normalizeText(form.querySelector('.box-title')?.textContent);
    if (!title.endsWith(name)) return { error: `форма запуска относится к другой команде («${title}»)` };

    const fields = [];
    const params = [];
    for (const element of form.elements) {
      if (!element.name || element.tagName === 'BUTTON') continue;
      if (element.type === 'hidden') fields.push([element.name, element.value]);
      else params.push(element.name);
    }
    if (params.length > 0)
      return { error: `у команды ${name} появились параметры (${params.join(', ')}) — запустите вручную` };
    if (!fields.some(([fieldName]) => /\[_token\]$/.test(fieldName)))
      return { error: `в форме ${name} нет CSRF-токена` };
    if (!form.querySelector(`button[name="${SUBMIT_NAME}"]`)) return { error: `в форме ${name} нет кнопки «Создать»` };

    fields.push([SUBMIT_NAME, '']);
    return { action: form.getAttribute('action'), fields };
  }

  function buildFormBody(fields) {
    return new URLSearchParams(fields).toString();
  }

  // Успех — Sonata после POST редиректит с формы (обычно на список задач команды) или показывает
  // .alert-success. Если вернулась та же форма создания — задача не создана (ошибка валидации/токена).
  function classifyLaunchResponse({ status, finalUrl, doc }) {
    if (status !== 200) return { ok: false, error: `HTTP ${status}` };
    const path = new URL(finalUrl).pathname;
    if (LOGIN_PATH_RE.test(path)) return { ok: false, error: 'сессия AGIS истекла — войдите заново' };
    if (doc.querySelector('.alert-success')) return { ok: true, path };
    if (CREATE_PATH_RE.test(path)) {
      const alert = normalizeText(doc.querySelector('.alert-danger, .alert-error')?.textContent);
      return {
        ok: false,
        error: alert ? `сервер отклонил запуск: ${alert}` : 'сервер вернул форму запуска — задача не создана',
      };
    }
    return { ok: true, path };
  }

  // --- Сеть -----------------------------------------------------------------

  // getHtml не различает «страница входа» и обычный ответ — проверяем finalUrl сами.
  async function getPage(url) {
    const page = await api.getHtml(url);
    if (LOGIN_PATH_RE.test(new URL(page.finalUrl).pathname)) throw new Error('сессия AGIS истекла — войдите заново');
    return page;
  }

  async function resolveCommand(name) {
    const { doc } = await getPage(buildFilterUrl(location.origin, name));
    const found = findExecutePath(doc, name);
    if (found.error) throw new Error(found.error);
    return new URL(found.path, location.origin).href;
  }

  async function launchCommand(name, createUrl) {
    const { doc } = await getPage(createUrl);
    const form = parseTaskForm(doc, name);
    if (form.error) throw new Error(form.error);

    const response = await httpRequest({
      method: 'POST',
      url: new URL(form.action, createUrl).href,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html,*/*' },
      data: buildFormBody(form.fields),
    });
    const result = classifyLaunchResponse({
      status: response.status,
      finalUrl: response.finalUrl || createUrl,
      doc: new DOMParser().parseFromString(response.responseText || '', 'text/html'),
    });
    if (!result.ok) throw new Error(`${name}: ${result.error}`);
    log('Запущена:', name, '→', result.path);
  }

  // --- Запуск ---------------------------------------------------------------

  function setBusy(link, busy) {
    link.setAttribute('aria-disabled', String(busy));
    link.style.setProperty('pointer-events', busy ? 'none' : '');
    link.style.setProperty('opacity', busy ? '0.5' : '');
  }

  async function runAll(link) {
    // Флаг ставится до первого await: два быстрых клика не должны оба дойти до confirm.
    if (running) return;
    running = true;
    try {
      await confirmAndRun(link);
    } finally {
      running = false;
    }
  }

  async function confirmAndRun(link) {
    const last = await storageGet(LAST_RUN_KEY, null);
    const recent = Boolean(last) && Number.isFinite(last.at) && Date.now() - last.at < REPEAT_WARN_MS;
    const lines = [
      `Запустить списание банкротов на ${location.host}?`,
      '',
      ...COMMANDS.map((name, index) => `${index + 1}. ${name}`),
      '',
      'Команды запускаются по очереди, окончания каждой скрипт не ждёт. Действие необратимо.',
      'Не закрывайте страницу, пока не появится итоговое сообщение.',
    ];
    if (recent) {
      const minutes = Math.max(1, Math.round((Date.now() - last.at) / 60000));
      lines.push('', `ВНИМАНИЕ: на этом бренде команды уже запускались ${minutes} мин. назад.`);
    }
    if (!window.confirm(lines.join('\n'))) return;

    setBusy(link, true);
    const launched = [];
    try {
      // Сначала находим все три команды: если хоть одной нет на бренде, ничего не запускаем.
      showBanner('Списание банкротов: ищу команды…', { type: 'info', durationMs: 60000 });
      const urls = [];
      for (const name of COMMANDS) urls.push(await resolveCommand(name));

      // Строго по очереди: следующая — только после того, как AGIS принял предыдущую.
      for (const [index, name] of COMMANDS.entries()) {
        showBanner(`Списание банкротов: запуск ${index + 1} из ${COMMANDS.length} — ${name}`, {
          type: 'info',
          durationMs: 60000,
        });
        await launchCommand(name, urls[index]);
        launched.push(name);
      }
      showBanner(`Списание банкротов: запущены все ${COMMANDS.length} команды.`, {
        type: 'success',
        durationMs: 15000,
      });
    } catch (error) {
      warn('Запуск остановлен:', error);
      showBanner(
        `Списание банкротов остановлено: ${error.message}. Запущено ${launched.length} из ${COMMANDS.length}` +
          (launched.length > 0 ? ` (${launched.join(', ')})` : '') +
          '.',
        { type: 'error', durationMs: 30000 },
      );
    } finally {
      if (launched.length > 0) {
        await storageSet(LAST_RUN_KEY, { at: Date.now(), commands: launched }).catch((error) =>
          warn('Не удалось сохранить время запуска:', error),
        );
      }
      setBusy(link, false);
    }
  }

  // --- Кнопка ---------------------------------------------------------------

  function renderButton(navCollapse) {
    document.getElementById(BUTTON_ID)?.closest('ul')?.remove();
    const list = document.createElement('ul');
    list.className = 'nav navbar-nav navbar-right';
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.id = BUTTON_ID;
    link.href = '#';
    link.className = 'sonata-action-element';
    const icon = document.createElement('i');
    icon.className = 'fas fa-gavel';
    icon.setAttribute('aria-hidden', 'true');
    link.append(icon, ' Списание банкротов');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      runAll(link).catch((error) => warn('Ошибка запуска:', error));
    });
    item.append(link);
    list.append(item);
    navCollapse.append(list);
  }

  // --- Точка входа ----------------------------------------------------------

  async function bootstrap() {
    cleanupRoute();
    const token = routeTokenController.next();
    log('Запуск', location.href);
    if (!isListRoute(location.pathname)) {
      document.getElementById(BUTTON_ID)?.closest('ul')?.remove();
      return;
    }
    // Ломкое место: панель действий списка Sonata («Добавить новый», «Фильтры»). Верхний навбар
    // AdminLTE — nav.navbar-static-top без .navbar-collapse, его селектор не захватывает.
    const navCollapse = await waitForElement('nav.navbar-default .navbar-collapse', { timeout: WAIT_TIMEOUT });
    if (!routeTokenController.isCurrent(token)) return;
    if (!document.getElementById(BUTTON_ID)) renderButton(navCollapse);
  }

  const rebootstrap = debounce(() => {
    bootstrap().catch((error) => warn('Ошибка переинициализации:', error));
  }, 150);

  // onUrlChange — синхронно, до любых await: стоп-функция нужна pagehide-обработчику.
  const stopUrlWatcher = onUrlChange(() => rebootstrap());

  window.addEventListener(
    'pagehide',
    () => {
      cleanup();
      stopUrlWatcher();
    },
    { once: true },
  );

  (async () => {
    debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    await bootstrap();
  })().catch((error) => warn('Ошибка запуска:', error));
})();
