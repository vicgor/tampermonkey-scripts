// ==UserScript==
// @name         AGIS: запрет передачи в БКИ по type (101–107) + заметка с task
// @namespace    agis.bki.ban
// @version      1.3.0
// @description  По ссылке loan/<id>/edit#type=<101–107>&task=RUSUPPORT-... ставит «Запрет передачи в БКИ» с причиной по коду type и создаёт заметку к займу со значением task.
// @author       vicgor
// @match        https://agis.volgazaim.ru/admin/*/loan/*/edit*
// @match        https://agis.creditsmile.ru/admin/*/loan/*/edit*
// @match        https://agis.moneymania.ru/admin/*/loan/*/edit*
// @match        https://agis.berrycash.ru/admin/*/loan/*/edit*
// @match        https://agis.belkacredit.ru/admin/*/loan/*/edit*
// @match        https://agis.credit7.ru/admin/*/loan/*/edit*
// @match        https://agis.credit365.ru/admin/*/loan/*/edit*
// @match        https://agis.vashcash.ru/admin/*/loan/*/edit*
// @match        https://agis.ikracredit.ru/admin/*/loan/*/edit*
// @match        https://agis.zaimix.ru/admin/*/loan/*/edit*
// @match        https://agis.finrook.ru/admin/*/loan/*/edit*
// @match        https://agis.volgazaim.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.creditsmile.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.moneymania.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.berrycash.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.belkacredit.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.credit7.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.credit365.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.vashcash.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.ikracredit.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.zaimix.ru/admin/*/loan/*/loannote/create*
// @match        https://agis.finrook.ru/admin/*/loan/*/loannote/create*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-bki-ban-note.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-bki-ban-note.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.4.0/lib/agis-core.js#sha256=JqxyWNETCOHKc6WMlT3E/6odW4N9iDA7zsnIOVz6uys=
// @run-at       document-start
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

// @run-at document-start — сознательно: hash (#type=10x&task=...) читается и сразу
// убирается из адресной строки, поэтому F5 посреди сценария не запускает запрет повторно.
// Вся работа с DOM при этом идёт только через waitForCondition/waitForElement ядра.

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[agis:bki-ban] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForElement,
    waitForCondition,
    cleanupRoute,
    cleanup,
    storageGet,
    storageSet,
    storageDelete,
    onUrlChange,
    createRouteTokenController,
    showBanner,
    registerDebugToggle,
    normalizeText,
  } = window.__AGIS_CORE__;

  // --- Настройки ---
  const SCRIPT_NS = 'agis:bki-ban';
  const PAYLOAD_KEY = `${SCRIPT_NS}:payload:v1`; // версия в ключе — на случай смены формата
  const DEBUG_KEY = `${SCRIPT_NS}:debug`;
  const WAIT_TIMEOUT = 15000;
  const ACTIVATE_ATTEMPT_TIMEOUT = 2000; // одна попытка нажать «Запрет передачи в БКИ»
  const ACTIVATE_ATTEMPTS = 3;
  const PAYLOAD_TTL_MS = 10 * 60 * 1000; // сценарий целиком должен уложиться в 10 минут

  // type из ссылки = value опции «Причина запрета экспорта» (select export_blocked_reason).
  // Названия — только для баннеров и сверки: выбор идёт по value, т.е. по коду.
  const BAN_REASONS = {
    101: 'Мошенничество',
    102: 'Контрольная закупка',
    103: 'Жалоба клиента',
    104: 'Решение суда',
    105: 'Запрос БКИ',
    106: 'Технический сбой',
    107: 'Иное',
  };
  // Безопасный режим по умолчанию: скрипт всё заполняет, «Сохранить» и «Создать» жмёт человек.
  // Переключить на true после успешного smoke-test'а.
  const AUTO_CONFIRM_BAN = false;
  const AUTO_SUBMIT_NOTE = false;

  // --- Селекторы (по реальной разметке loan/<id>/edit) ---
  // Префикс формы Sonata (s6acb3cd20e2c4) генерируется на каждый рендер — поэтому только
  // суффиксы id. Кнопка: основной селектор по id, запасной — по тексту внутри блока
  // «Действия» (на случай другого id перехода на другом бренде).
  const BAN_BUTTON_SELECTOR = 'button#transition-83';
  const TRANSITION_BUTTONS_SELECTOR = '[id^="div"][id$="_transition"] button';
  const BAN_BUTTON_TEXT_RE = /^запрет передачи в бки$/i;
  const REASON_CONTAINER_SELECTOR = '[id^="sonata-ba-field-container-"][id$="_export_blocked_reason"]';
  const SAVE_BUTTON_SELECTOR = 'button[name="btn_update_and_edit"]';
  // Результат сохранения Sonata: flash-сообщение над формой после редиректа или ошибки в форме.
  const SAVE_ERROR_SELECTOR = '.alert-danger, .sonata-ba-field-error-messages, .has-error';
  const SAVE_SUCCESS_SELECTOR = '.alert-success';

  const LOAN_EDIT_RE = /\/loan\/(\d+)\/edit\/?$/i;
  const NOTE_CREATE_RE = /\/loan\/(\d+)\/loannote\/create\/?$/i;
  const TASK_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
  // Тот же селектор поля «Содержание», что в agis-rusupport-clipboard.user.js
  const NOTE_CONTENT_SELECTOR = [
    'textarea[id$="content"][name$="content"]',
    '[id^="sonata-ba-field-container-"][id$="content"] textarea',
  ].join(', ');
  const NOTE_SUBMIT_SELECTOR = 'button[name="btn_create_and_list"], button[name^="btn_create"]';

  // Текст заметки — ровно значение task, как просили. Расширяется здесь.
  const buildNoteText = (task) => task;

  let debugCtl = { value: false };
  const log = (...a) => {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a);
  };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // submit-слушатель на форме не входит в cleanupRoute() ядра —
  // снимаем его через AbortController при смене маршрута и на pagehide.
  let routeAbort = new AbortController();

  // Флаг для собственного history.replaceState (очистка hash): onUrlChange увидит
  // смену URL, но перезапускать bootstrap и рвать текущий сценарий не нужно.
  let ignoreNextUrlChange = false;

  // --- Хелперы ---
  // getClientRects() пустой у элемента с display:none у него или у предка — так видно,
  // показала ли страница поле «Причина запрета экспорта».
  function isShown(el) {
    return !!el && el.isConnected && el.getClientRects().length > 0;
  }

  function findBanButton() {
    const byId = document.querySelector(BAN_BUTTON_SELECTOR);
    if (byId) return byId;
    return (
      [...document.querySelectorAll(TRANSITION_BUTTONS_SELECTOR)].find((b) =>
        BAN_BUTTON_TEXT_RE.test(normalizeText(b.textContent)),
      ) || null
    );
  }

  // Ожидание полной инициализации страницы. Ready-обработчики AGIS ($(function(){...}))
  // в конце страницы прячут все поля переходов и вызывают $('.transition_select').change(),
  // а обработчик change делает resetForm() — сбрасывает поля формы к исходным значениям.
  // Если выбрать причину ДО этого, страница молча вернёт «Мошенничество». Поэтому ждём
  // window.load (позже DOMContentLoaded и ready) плюс один macrotask: в jQuery 3
  // ready-колбэки выполняются асинхронно через setTimeout.
  // Это события окна, а не изменения DOM, поэтому здесь не MutationObserver.
  function pageReady() {
    const afterTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    if (document.readyState === 'complete') return afterTick();
    return new Promise((resolve) => window.addEventListener('load', resolve, { once: true })).then(afterTick);
  }

  // Ждём не одну кнопку, а всю нужную разметку формы. На document-start HTML ещё грузится
  // потоком: кнопка перехода стоит в начале формы, а поле причины и «Сохранить» — ниже,
  // и в момент появления кнопки их в DOM ещё нет (именно это давало ошибку в 1.1.0).
  function findBanControls() {
    const button = findBanButton();
    const form = button?.closest('form');
    const reasonContainer = form?.querySelector(REASON_CONTAINER_SELECTOR);
    const saveButton = form?.querySelector(SAVE_BUTTON_SELECTOR);
    return button && form && reasonContainer && saveButton ? { button, form, reasonContainer, saveButton } : null;
  }

  // waitForCondition с «мягким» таймаутом: вместо исключения — последняя проверка probe().
  // Нужна потому, что waitForCondition реагирует на childList/characterData, а показ поля
  // делается сменой style (атрибут) — финальная проверка страхует этот случай.
  async function waitOrLastCheck(probe, timeout, describe) {
    try {
      return await waitForCondition(probe, { timeout, describe });
    } catch {
      return probe() || null;
    }
  }

  function clearHash() {
    ignoreNextUrlChange = true;
    history.replaceState(history.state, '', location.pathname + location.search);
  }

  function isUsablePayload(payload, loanId, stage) {
    return (
      !!payload &&
      payload.loanId === loanId &&
      payload.stage === stage &&
      Date.now() - payload.createdAt < PAYLOAD_TTL_MS
    );
  }

  // --- Шаг 1а: нажатие «Запрет передачи в БКИ» ---
  // Обработчик кнопки страница вешает в $(function(){...}) и он работает как ТУМБЛЕР:
  // клик по уже активной (.active) кнопке снимает переход. Поэтому:
  //   - кликаем только если кнопка не .active;
  //   - кликаем только после pageReady() — когда обработчики страницы уже привязаны;
  //   - подтверждаем эффект (кнопка .active + поле причины видно) и при неудаче повторяем.
  async function activateBanTransition(token, button, reasonContainer) {
    await pageReady();
    if (!routeTokenController.isCurrent(token)) return false;

    for (let attempt = 1; attempt <= ACTIVATE_ATTEMPTS; attempt += 1) {
      if (!button.classList.contains('active')) button.click();
      const ok = await waitOrLastCheck(
        () => button.classList.contains('active') && isShown(reasonContainer),
        ACTIVATE_ATTEMPT_TIMEOUT,
        'активация «Запрет передачи в БКИ»',
      );
      if (!routeTokenController.isCurrent(token)) return false;
      if (ok) return true;
      log(`Попытка ${attempt}: переход не активировался, повторяю`);
    }
    return false;
  }

  // --- Шаг 1б: причина по коду type ---
  function setReason(reasonContainer, type) {
    const select = reasonContainer.querySelector('select');
    if (!select) throw new Error('не найден select «Причина запрета экспорта»');
    const option = [...select.options].find((o) => o.value === type);
    if (!option) throw new Error(`в «Причине запрета экспорта» нет варианта с кодом ${type}`);
    // Справочник на другом бренде может отличаться: выбираем по коду, а расхождение
    // названия только логируем — фактический текст опции всё равно показываем в баннере.
    const optionText = normalizeText(option.textContent);
    if (optionText !== BAN_REASONS[type])
      warn(`Код ${type}: на странице «${optionText}», ожидалось «${BAN_REASONS[type]}»`);

    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // select2 в Sonata обновляет видимое значение только по jQuery-событию.
    if (window.jQuery) window.jQuery(select).trigger('change');

    if (select.value !== option.value) throw new Error(`не удалось выбрать причину «${optionText}»`);
    return { select, option, optionText };
  }

  // --- Шаг 1: запрет передачи в БКИ ---
  async function runBanFlow(token, loanId, type, task) {
    const payload = { loanId, type, task, stage: 'ban', createdAt: Date.now() };
    await storageSet(PAYLOAD_KEY, payload);
    if (!routeTokenController.isCurrent(token)) return;

    const controls = await waitOrLastCheck(findBanControls, WAIT_TIMEOUT, 'форма запрета в БКИ');
    if (!routeTokenController.isCurrent(token)) return;
    if (!controls) {
      // Различаем причины для понятного баннера.
      if (!findBanButton()) {
        throw new Error('нет кнопки «Запрет передачи в БКИ» — переход недоступен для займа в этом статусе?');
      }
      throw new Error('не найдены поле «Причина запрета экспорта» или кнопка «Сохранить»');
    }
    const { button, form, reasonContainer, saveButton } = controls;

    const activated = await activateBanTransition(token, button, reasonContainer);
    if (!routeTokenController.isCurrent(token)) return;
    if (!activated) throw new Error('кнопка «Запрет передачи в БКИ» не активировалась — нажмите её вручную');

    const { select, option, optionText } = setReason(reasonContainer, type);
    log(`Переход активирован, причина «${optionText}» (${type}) выбрана`);

    // Сохранение — обычный POST формы с перезагрузкой страницы. На submit помечаем стадию
    // 'saved'; результат проверим после перезагрузки (см. resumeAfterSave).
    // Без await: обработчик submit не может задержать отправку формы, а в @sandbox DOM
    // GM_setValue фактически синхронный — запись успевает до ухода со страницы.
    form.addEventListener(
      'submit',
      () => {
        const stillBan = button.classList.contains('active') && select.value === option.value;
        if (stillBan) storageSet(PAYLOAD_KEY, { ...payload, stage: 'saved' });
        else log('Форма отправлена без запрета или с другой причиной — заметку не создаю');
      },
      { capture: true, once: true, signal: routeAbort.signal },
    );

    if (AUTO_CONFIRM_BAN) {
      saveButton.click();
      return;
    }
    saveButton.style.outline = '3px solid #f39c12';
    saveButton.scrollIntoView({ block: 'center' });
    showBanner(
      `Запрет в БКИ с причиной «${optionText}» подготовлен (${task}). Нажмите «Сохранить» — заметку добавлю после.`,
      {
        type: 'info',
        durationMs: 15000,
      },
    );
  }

  // --- Шаг 2: проверка результата сохранения и переход к заметке ---
  function detectSaveResult() {
    if (document.querySelector(SAVE_ERROR_SELECTOR)) return 'error';
    if (document.querySelector(SAVE_SUCCESS_SELECTOR)) return 'ok';
    return null;
  }

  async function resumeAfterSave(token, payload) {
    const result = await waitOrLastCheck(detectSaveResult, WAIT_TIMEOUT, 'результат сохранения формы');
    if (!routeTokenController.isCurrent(token)) return;

    if (result !== 'ok') {
      // Ошибка или непонятный результат — заметку «вслепую» не создаём.
      await storageDelete(PAYLOAD_KEY);
      if (!routeTokenController.isCurrent(token)) return;
      showBanner(
        result === 'error'
          ? 'Сохранение запрета не прошло — проверьте ошибки формы. Заметка не создана.'
          : 'Не удалось подтвердить сохранение запрета. Проверьте займ и добавьте заметку вручную.',
        { type: 'error', durationMs: 12000 },
      );
      return;
    }
    showBanner('Запрет сохранён, перехожу к созданию заметки…', { type: 'info' });
    await goToNote(token, payload);
  }

  // storageSet (не debounced) + await: запись должна завершиться ДО ухода со страницы.
  async function goToNote(token, payload) {
    await storageSet(PAYLOAD_KEY, { ...payload, stage: 'note' });
    if (!routeTokenController.isCurrent(token)) return;
    const noteUrl = location.pathname.replace(/\/edit\/?$/, '/loannote/create');
    log('Переход к созданию заметки:', noteUrl);
    location.assign(noteUrl);
  }

  // --- Шаг 3: заполнение заметки ---
  async function runNoteFill(token, loanId) {
    const payload = await storageGet(PAYLOAD_KEY, null);
    if (!routeTokenController.isCurrent(token)) return;
    if (!isUsablePayload(payload, loanId, 'note')) return; // обычное создание заметки — не наше дело

    const textarea = await waitForElement(NOTE_CONTENT_SELECTOR, { timeout: WAIT_TIMEOUT });
    if (!routeTokenController.isCurrent(token)) return;

    const text = buildNoteText(payload.task);
    if (!textarea.value.includes(text)) {
      textarea.value = textarea.value.trim() ? `${textarea.value.trimEnd()}\n${text}` : text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Payload удаляем только после успешного заполнения — сценарий завершён.
    await storageDelete(PAYLOAD_KEY);
    if (!routeTokenController.isCurrent(token)) return;

    if (AUTO_SUBMIT_NOTE) {
      const submit = document.querySelector(NOTE_SUBMIT_SELECTOR);
      if (submit) {
        submit.click();
        return;
      }
      warn('Кнопка создания заметки не найдена:', NOTE_SUBMIT_SELECTOR);
    }
    textarea.focus();
    showBanner(`Заметка заполнена: ${text}. Проверьте и нажмите «Создать».`, { type: 'success' });
  }

  // --- Точка входа ---
  async function bootstrap(reason = 'start') {
    const token = routeTokenController.next();
    cleanupRoute(); // всегда первым действием (после выдачи токена)
    routeAbort.abort();
    routeAbort = new AbortController();
    log('Инициализация:', reason);

    try {
      // На document-start body может ещё не быть, а showBanner пишет в document.body.
      await waitForElement('body', { timeout: WAIT_TIMEOUT });
      if (!routeTokenController.isCurrent(token)) return;

      const noteMatch = location.pathname.match(NOTE_CREATE_RE);
      if (noteMatch) {
        await runNoteFill(token, noteMatch[1]);
        return;
      }

      const editMatch = location.pathname.match(LOAN_EDIT_RE);
      if (!editMatch) return;
      const loanId = editMatch[1];

      const params = new URLSearchParams(location.hash.replace(/^#/, ''));
      const type = (params.get('type') || '').trim();
      if (Object.hasOwn(BAN_REASONS, type)) {
        // Hash с type из BAN_REASONS — наш: убираем сразу, чтобы F5 не повторял сценарий.
        // Hash с другим type не трогаем — его может использовать другой скрипт.
        const task = (params.get('task') || '').trim();
        clearHash();
        if (!TASK_RE.test(task)) {
          warn('Некорректный параметр task:', task);
          showBanner(`Параметр task пустой или некорректный («${task}») — запрет не ставлю.`, { type: 'error' });
          return;
        }
        await runBanFlow(token, loanId, type, task);
        return;
      }

      // Без hash: возможно, это перезагрузка после «Сохранить» (stage: 'saved').
      // stage: 'ban' сознательно НЕ возобновляется — повторное нажатие запрета
      // без явной ссылки опаснее, чем недоделанная заметка.
      const payload = await storageGet(PAYLOAD_KEY, null);
      if (!routeTokenController.isCurrent(token)) return;
      if (isUsablePayload(payload, loanId, 'saved')) {
        await resumeAfterSave(token, payload);
      } else if (payload && Date.now() - payload.createdAt >= PAYLOAD_TTL_MS) {
        await storageDelete(PAYLOAD_KEY); // протухший хвост — чистим
      }
    } catch (err) {
      warn(`Ошибка (${reason}):`, err.message);
      showBanner(`Запрет в БКИ: ${err.message}`, { type: 'error', durationMs: 12000 });
    }
  }

  // --- Запуск ---
  // onUrlChange — синхронно, до любых await.
  const stopUrlWatcher = onUrlChange((url) => {
    if (ignoreNextUrlChange) {
      ignoreNextUrlChange = false;
      return;
    }
    log('Смена URL:', url);
    bootstrap('url-change');
  });

  window.addEventListener(
    'pagehide',
    () => {
      routeAbort.abort();
      cleanup();
      stopUrlWatcher();
    },
    { once: true },
  );

  (async () => {
    try {
      debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    } catch (err) {
      warn('Инициализация debug-toggle не удалась:', err);
    }
    bootstrap('document-start');
  })();
})();
