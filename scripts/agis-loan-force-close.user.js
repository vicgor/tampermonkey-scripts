// ==UserScript==
// @name         AGIS - закрытие займов из Google Таблицы
// @namespace    agis.loan.force-close
// @version      1.0.1
// @description  Список займов из Google Таблицы (CSV Publish) → на карточке займа панель с кнопкой «Заполнить закрытие»: выбирает переход «Принудительное закрытие», подставляет причину, дату и комментарий из таблицы и снимает СМС клиенту. Отправка формы — только вручную.
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.berrycash.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.moneymania.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.credit7.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.credit365.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.vashcash.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.ikracredit.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.zaimix.ru/admin/agis2/core/loan*/*/edit
// @match        https://agis.finrook.ru/admin/agis2/core/loan*/*/edit
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-force-close.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-force-close.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.4.0/lib/agis-core.js#sha256=JqxyWNETCOHKc6WMlT3E/6odW4N9iDA7zsnIOVz6uys=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      docs.google.com
// @connect      googleusercontent.com
// ==/UserScript==

// Колонки таблицы (CSV Publish, первая строка — заголовки; регистр не важен):
//   loanid | reason | date | comment
//   loanid  — номер займа (цифры);
//   reason  — причина закрытия: значение из списка («fraud_loan_taken_other_person») или его полный текст
//             в админке («Мошенничество - Заем взят на другое лицо»); только точное совпадение;
//   date    — дата закрытия ДД.ММ.ГГГГ или ГГГГ-ММ-ДД (время — текущее московское, дата не в будущем);
//   comment — комментарий с номером задачи («Мошенничество RUSUPPORT-75272»).
// Займы, которые закрывать нельзя, в таблицу просто не включаются. Ссылка на таблицу, список и
// отметки «выполнено» хранятся отдельно для каждого бренда (хоста): номера займов брендов пересекаются.
// Форма заполняется, но НЕ отправляется — кнопку «Обновить» нажимает человек. Закрытие необратимо.

(() => {
  'use strict';

  // Константы объявлены до guard'а ниже: экспортируемые для тестов функции читают их по замыканию
  // (иначе при раннем return в Node-ветке вызов упал бы в TDZ).
  const FORCE_CLOSE_TRANSITION_VALUE = '26'; // LoanTransitionType::TRANSITION_FORCE_CLOSE
  const FORCE_CLOSE_TEXT_PATTERN = /принудительн\S*\s+закрыт/iu;
  // «Форма заполнена/отправлена, ждём перезагрузки с результатом»: оператор отправляет форму вскоре
  // после заполнения, запись старше 10 минут — хвост от брошенного заполнения, её не применяем.
  const PENDING_TTL = 10 * 60 * 1000;
  const PENDING_STAGES = ['armed', 'submitted'];
  // Flash-плашка Sonata (FlashMessage/render.html.twig) — закрываемый .alert с крестиком. Постоянные
  // .alert-* виджеты карточки (просрочка, долг) не закрываются — результатом сохранения не считаем.
  const FLASH_SELECTOR = '.alert.alert-dismissable, .alert.alert-dismissible';
  const FLASH_CLOSE_SELECTOR = '[data-dismiss="alert"], [data-bs-dismiss="alert"]';
  const QUEUE_TTL = 10 * 60 * 1000; // кэш списка из таблицы
  // Часовой пояс сервера AGIS: сервер проверяет, что момент закрытия не в будущем, по своему времени,
  // а оператор может сидеть в другом поясе. Допущение — все бренды на московском времени.
  const SERVER_TIME_ZONE = 'Europe/Moscow';
  const HEADER_ALIASES = {
    loanId: ['loanid', 'loan_id', 'loan-id', 'loan', 'номер займа', 'номер договора', 'договор', 'займ'],
    reason: ['reason', 'причина'],
    date: ['date', 'дата', 'дата закрытия'],
    comment: ['comment', 'комментарий'],
  };

  // normalizeText приходит из ядра (window.__AGIS_CORE__) — либо из require() в Node-ветке теста.
  let normalizeText;

  // Тестовый экспорт для vitest (см. test/scripts/agis-loan-force-close*.test.js) — до window-guard'а,
  // т.к. в Node window не определён. В Tampermonkey process/module не определены — ветка мёртвая.
  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    normalizeText = require('../lib/agis-core.js').normalizeText;
    module.exports = {
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
      looksLikeHtml,
      selectTransition,
      fillCloseFields,
      isForceCloseSubmission,
      watchSubmit,
      detectCloseResult,
    };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:loan-force-close] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForCondition,
    cleanupRoute,
    cleanup,
    onUrlChange,
    createRouteTokenController,
    registerDebugToggle,
    storageGet,
    storageSet,
    storageDelete,
    httpRequest,
    showBanner,
    debounce,
  } = window.__AGIS_CORE__;
  normalizeText = window.__AGIS_CORE__.normalizeText;

  const SCRIPT_NS = 'agis:loan-force-close';
  const DOM_NS = 'agis-loan-force-close'; // без двоеточия — для id/CSS
  const PANEL_ID = `${DOM_NS}-panel`;
  // GM-хранилище общее для всех @match-доменов, а номера займов у брендов пересекаются — поэтому
  // всё, кроме debug-флага, хранится с хостом в ключе.
  const HOST = location.host;
  const SHEET_URL_KEY = `${SCRIPT_NS}:sheet-url:v1:${HOST}`;
  const QUEUE_KEY = `${SCRIPT_NS}:queue:v1:${HOST}`;
  // Отметка «выполнено» — отдельный ключ на займ: общий объект-словарь переписывался бы целиком
  // из двух вкладок сразу (read-modify-write), и одна отметка терялась бы.
  const DONE_PREFIX = `${SCRIPT_NS}:done:v1:${HOST}`;
  const PENDING_PREFIX = `${SCRIPT_NS}:pending:v1:${HOST}`;
  const DEBUG_KEY = `${SCRIPT_NS}:debug`;
  const WAIT_TIMEOUT = 30000;

  // registerDebugToggle асинхронный — до резолва debugCtl.value всегда false, поэтому его await'им
  // перед первым bootstrap() (см. низ файла).
  let debugCtl = { value: false };
  const log = (...a) => {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a);
  };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}][${location.host}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // submit-слушатель формы и ожидания fillForm не входят в cleanupRoute() ядра —
  // снимаем/завершаем их через AbortController при смене маршрута и на pagehide.
  let routeAbort = new AbortController();

  // --- Чистые функции (экспортируются в тесты) ------------------------------

  function pad(n) {
    return n < 10 ? `0${n}` : String(n);
  }

  function normalizeComparable(value) {
    return normalizeText(value).toLocaleLowerCase('ru-RU');
  }

  // Ломкое место: путь страницы AGIS. Раздел админки (loan, loan-overdue, loan-collection-agency…)
  // сохраняем: займ в статусе «ожидает коллектора» может открываться не в разделе loan.
  function parseRoute(pathname) {
    const match = String(pathname || '').match(/^\/admin\/agis2\/core\/(loan[\w-]*)\/(\d+)\/edit\/?$/);
    if (!match) return null;
    return { section: match[1], loanId: match[2] };
  }

  function detectDelimiter(text) {
    const header = String(text || '').split(/\r?\n/, 1)[0];
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestCount = 0;
    for (const delimiter of candidates) {
      const count = header.split(delimiter).length - 1;
      if (count > bestCount) {
        best = delimiter;
        bestCount = count;
      }
    }
    return best;
  }

  // RFC 4180-совместимый разбор (кавычки, "" внутри кавычек, переводы строк внутри поля).
  function tokenizeCSV(text, delimiter = ',') {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const source = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (inQuotes) {
        if (ch === '"' && source[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  function mapHeader(headerRow) {
    const columns = {};
    headerRow.forEach((cell, index) => {
      const name = normalizeComparable(cell);
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (columns[key] === undefined && aliases.includes(name)) columns[key] = index;
      }
    });
    return columns;
  }

  // Возвращает { items, errors }. Строка с ошибкой в очередь не попадает (закрывать займ «наполовину
  // разобранной» строкой нельзя) — причина уходит в errors с номером строки. Дубли займов отбрасываются.
  // Будущая дата — тоже ошибка строки: иначе займ висел бы в очереди, а «Следующий» вёл бы на него.
  function parseQueue(csvText, now = new Date()) {
    const text = String(csvText || '').replace(/^\uFEFF/u, '');
    const rows = tokenizeCSV(text, detectDelimiter(text));
    const items = [];
    const errors = [];
    if (rows.length === 0) return { items, errors: ['таблица пуста'] };

    const columns = mapHeader(rows[0]);
    const missing = Object.keys(HEADER_ALIASES).filter((key) => columns[key] === undefined);
    if (missing.length > 0) {
      return { items, errors: [`нет колонок: ${missing.join(', ')} (нужны loanid, reason, date, comment)`] };
    }

    const seen = new Set();
    rows.slice(1).forEach((cells, index) => {
      const line = index + 2;
      if (cells.every((cell) => normalizeText(cell) === '')) return;
      const loanId = normalizeText(cells[columns.loanId]);
      const reason = normalizeText(cells[columns.reason]);
      const date = normalizeText(cells[columns.date]);
      const comment = normalizeText(cells[columns.comment]);

      if (!/^\d+$/.test(loanId)) return errors.push(`строка ${line}: некорректный номер займа «${loanId}»`);
      if (seen.has(loanId)) return errors.push(`строка ${line}: займ ${loanId} уже есть выше — пропущен`);
      if (!reason) return errors.push(`строка ${line}: займ ${loanId} — пустая причина`);
      if (!comment) return errors.push(`строка ${line}: займ ${loanId} — пустой комментарий`);
      if (toCloseDateTime(date, now) === null) {
        return errors.push(`строка ${line}: займ ${loanId} — некорректная или будущая дата «${date}»`);
      }
      seen.add(loanId);
      items.push({ loanId, reason, date, comment });
    });
    return { items, errors };
  }

  // Календарные дата и время момента `date` в поясе timeZone (не в поясе браузера оператора).
  function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  }

  // Дата из таблицы + ТЕКУЩЕЕ время сервера: сервер проверяет, что момент закрытия не в будущем, а время
  // «23:59:59» вчерашнего дня могло бы оказаться раньше последнего прихода. Прошедшую дату берём
  // как есть, будущую (позже сегодняшней по времени сервера) отклоняем — null.
  function toCloseDateTime(dateText, now = new Date(), timeZone = SERVER_TIME_ZONE) {
    const text = normalizeText(dateText);
    let day;
    let month;
    let year;
    let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    } else {
      match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    }
    const probe = new Date(year, month - 1, day);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
    const server = zonedParts(now, timeZone);
    const dayKey = (y, m, d) => y * 10000 + m * 100 + d;
    if (dayKey(year, month, day) > dayKey(server.year, server.month, server.day)) return null;
    return `${year}-${pad(month)}-${pad(day)} ` + `${pad(server.hour)}:${pad(server.minute)}:${pad(server.second)}`;
  }

  // Выбор option только по точному значению или полному тексту (без учёта регистра/пробелов).
  // Частичное совпадение не принимаем даже единственное: обрезанная «другое лицо» в таблице тихо
  // выбрала бы причину, которую никто не проверял, а закрытие необратимо.
  function findOption(options, desired) {
    const wanted = normalizeComparable(desired);
    if (!wanted) return { option: null, reason: 'empty' };
    const list = options.filter((item) => item.value !== '');
    const byValue = list.filter((item) => normalizeComparable(item.value) === wanted);
    if (byValue.length === 1) return { option: byValue[0], reason: 'value' };
    const byText = list.filter((item) => normalizeComparable(item.text) === wanted);
    if (byText.length === 1) return { option: byText[0], reason: 'text' };
    const ambiguous = byValue.length > 1 || byText.length > 1;
    return { option: null, reason: ambiguous ? 'ambiguous' : 'none' };
  }

  function findForceCloseTransition(options) {
    const matches = options.filter(
      (item) => item.value === FORCE_CLOSE_TRANSITION_VALUE || FORCE_CLOSE_TEXT_PATTERN.test(normalizeText(item.text)),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function isDone(done, item) {
    const record = done?.[item.loanId];
    return Boolean(record) && record.comment === item.comment;
  }

  function progressOf(items, done) {
    const doneCount = items.filter((item) => isDone(done, item)).length;
    return { total: items.length, done: doneCount, left: items.length - doneCount };
  }

  // Следующий невыполненный займ после текущего (по порядку таблицы), затем — с начала списка.
  function pickNext(items, done, currentLoanId) {
    const pending = items.filter((item) => !isDone(done, item) && item.loanId !== currentLoanId);
    if (pending.length === 0) return null;
    const currentIndex = items.findIndex((item) => item.loanId === currentLoanId);
    return pending.find((item) => items.indexOf(item) > currentIndex) || pending[0];
  }

  // 'armed' пишется после успешного заполнения формы, 'submitted' — на submit с нашим переходом и
  // причиной (см. watchSubmit). Сама запись займ выполненным не делает: отметка ставится только при
  // подтверждённом закрытии (detectCloseResult === 'closed'), так что чужое сохранение карточки не в счёт.
  function isPendingUsable(payload, loanId, now = Date.now()) {
    if (!payload || !PENDING_STAGES.includes(payload.stage) || payload.loanId !== loanId) return false;
    if (!Number.isFinite(payload.at)) return false;
    return now - payload.at <= PENDING_TTL;
  }

  // Неопубликованная таблица / нет доступа: Google отвечает 200 и HTML-страницей входа вместо CSV.
  function looksLikeHtml(text) {
    return /^\s*</.test(String(text || ''));
  }

  // --- Работа с формой (принимает document — тестируется в jsdom) -----------

  function readOptions(select) {
    return Array.from(select.options).map((option) => ({
      value: option.value,
      text: normalizeText(option.textContent),
    }));
  }

  function dispatchFieldEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    // Обработчики формы AGIS навешены через jQuery (Select2/datepicker): нативного события обычно
    // достаточно, но если jQuery виден из песочницы — дублируем, как в agis-add-income-from-googlesheet.
    if (typeof window !== 'undefined' && window.jQuery) window.jQuery(field).trigger('change');
  }

  // «2026-10-13 12:34:56» и «2026-10-13T12:34:56.000» — один момент: сравниваем ГГГГММДДЧЧММСС.
  function sameDateTime(actual, expected) {
    const digits = (value) =>
      String(value || '')
        .replace(/\D/g, '')
        .padEnd(14, '0')
        .slice(0, 14);
    return String(actual || '') !== '' && digits(actual) === digits(expected);
  }

  // Нативный сеттер value: контролируемые инпуты игнорируют прямое присваивание field.value.
  function setFieldValue(field, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    if (descriptor?.set) descriptor.set.call(field, value);
    else field.value = value;
    dispatchFieldEvents(field);
  }

  function setSelectValue(select, value) {
    select.value = value;
    dispatchFieldEvents(select);
  }

  // Шаг 1: выбрать переход «Принудительное закрытие». После него скрипт страницы AGIS показывает
  // поля даты/причины/комментария — их заполняем отдельным шагом (fillCloseFields).
  function selectTransition(doc) {
    const select = doc.querySelector('select.transition_select');
    if (!select) return { ok: false, problem: 'не найден список переходов (.transition_select)' };
    const transition = findForceCloseTransition(readOptions(select));
    if (!transition) {
      return {
        ok: false,
        problem: 'в списке переходов нет «Принудительное закрытие» (займ уже закрыт или в другом статусе)',
      };
    }
    setSelectValue(select, transition.value);
    return { ok: true, field: select };
  }

  // Шаг 2: причина, дата, комментарий, СМС. Возвращает { fields, problems }: при любой проблеме
  // человек должен увидеть, что именно не заполнилось, и не отправлять форму.
  function fillCloseFields(doc, { reason, closeDateTime, comment }) {
    const fields = [];
    const problems = [];

    const reasonSelect = doc.querySelector('select.force_close_reason');
    if (!reasonSelect) {
      problems.push('не найдено поле причины (.force_close_reason)');
    } else {
      const found = findOption(readOptions(reasonSelect), reason);
      if (found.option) {
        setSelectValue(reasonSelect, found.option.value);
        fields.push(reasonSelect);
      } else {
        const why = found.reason === 'ambiguous' ? 'совпадает с несколькими причинами' : 'такой причины нет в списке';
        problems.push(`причина «${reason}»: ${why}`);
      }
    }

    // Тип поля даты на брендах не проверен вручную. date/datetime-local молча очищают значение, которое
    // не смогли разобрать, а принятое нормализуют («…T12:34:56.000», без «:00» секунд) — поэтому для
    // datetime-local каноничный «T», а проверка «значение встало» — по цифрам даты-времени.
    const dateInput = doc.querySelector('input.close_date');
    if (!dateInput) {
      problems.push('не найдено поле даты закрытия (.close_date)');
    } else {
      const dateValue = dateInput.type === 'datetime-local' ? closeDateTime.replace(' ', 'T') : closeDateTime;
      setFieldValue(dateInput, dateValue);
      if (sameDateTime(dateInput.value, closeDateTime)) fields.push(dateInput);
      else problems.push(`поле даты закрытия не приняло «${dateValue}» (тип поля: ${dateInput.type})`);
    }

    const commentInput = doc.querySelector('input.force_close_comment');
    if (!commentInput) {
      problems.push('не найдено поле комментария (.force_close_comment)');
    } else {
      setFieldValue(commentInput, comment);
      if (commentInput.value === comment) fields.push(commentInput);
      else problems.push('поле комментария не приняло значение');
    }

    // СМС «об изменении статуса» по умолчанию включено — для закрытия по мошенничеству клиенту писать
    // не нужно. Нет чекбокса — это проблема, а не «пропустить»: иначе баннер соврал бы «СМС снято».
    const smsCheckbox = doc.querySelector('input.change_status_checkbox_sms');
    if (!smsCheckbox) {
      problems.push('не найден чекбокс СМС клиенту (.change_status_checkbox_sms) — снимите СМС вручную');
    } else {
      if (smsCheckbox.checked) {
        smsCheckbox.checked = false;
        dispatchFieldEvents(smsCheckbox);
      }
      if (smsCheckbox.checked) problems.push('не удалось снять СМС клиенту');
      else fields.push(smsCheckbox);
    }

    return { fields, problems };
  }

  // Отправляется ли форма с принудительным закрытием и той причиной, что выбрал скрипт: оператор мог
  // после заполнения переключить переход или причину — тогда это не наше закрытие.
  function isForceCloseSubmission(doc, reasonValue) {
    const select = doc.querySelector('select.transition_select');
    const reasonSelect = doc.querySelector('select.force_close_reason');
    if (!select || !reasonSelect) return false;
    const transition = findForceCloseTransition(readOptions(select));
    return Boolean(transition) && select.value === transition.value && reasonSelect.value === reasonValue;
  }

  // Слежение за отправкой формы. Capture: срабатывает до обработчиков страницы. Без once: валидация
  // страницы может отменить первую отправку (preventDefault уже после нас) — повторная тоже должна
  // сюда дойти; onOurs/onOther идемпотентны.
  function watchSubmit(form, reasonValue, { onOurs, onOther, signal }) {
    form.addEventListener(
      'submit',
      () => {
        if (isForceCloseSubmission(form.ownerDocument, reasonValue)) onOurs();
        else onOther();
      },
      { capture: true, signal },
    );
  }

  function flashAlerts(doc) {
    return Array.from(doc.querySelectorAll('.alert')).filter(
      (alert) => alert.matches(FLASH_SELECTOR) || alert.querySelector(FLASH_CLOSE_SELECTOR) !== null,
    );
  }

  // Результат после перезагрузки карточки: 'error' — ошибки полей формы/красная flash-плашка;
  // 'closed' — зелёная flash-плашка И перехода «Принудительное закрытие» больше нет (статус займа
  // сменился); 'unconfirmed' — зелёная плашка, но переход всё ещё предлагается; null — плашек нет.
  // Ищем только flash-плашки и ошибки внутри формы: постоянный красный виджет карточки иначе давал бы
  // 'error' всегда.
  function detectCloseResult(doc) {
    const flashes = flashAlerts(doc);
    const form = doc.querySelector('select.transition_select')?.closest('form') || doc;
    if (flashes.some((alert) => alert.matches('.alert-danger, .alert-error'))) return 'error';
    if (form.querySelector('.has-error, .sonata-ba-field-error')) return 'error';
    if (!flashes.some((alert) => alert.matches('.alert-success'))) return null;
    const select = doc.querySelector('select.transition_select');
    const stillOffered = select ? findForceCloseTransition(readOptions(select)) !== null : false;
    return stillOffered ? 'unconfirmed' : 'closed';
  }

  // --- Хранилище и сеть ------------------------------------------------------

  const pendingKey = (loanId) => `${PENDING_PREFIX}:${loanId}`;
  const doneKey = (loanId) => `${DONE_PREFIX}:${loanId}`;

  async function fetchCsv(url) {
    // docs.google.com → *.googleusercontent.com: GM_xmlhttpRequest следует редиректам, оба хоста в @connect.
    const response = await httpRequest({ method: 'GET', url });
    if (response.status !== 200) throw new Error(`HTTP ${response.status} ${response.finalUrl || url}`);
    if (looksLikeHtml(response.responseText)) {
      throw new Error('вместо CSV пришла HTML-страница — таблица не опубликована или нет доступа');
    }
    return response.responseText;
  }

  async function loadQueue(sheetUrl, force) {
    const cached = await storageGet(QUEUE_KEY, null);
    const usable = cached && cached.url === sheetUrl && Array.isArray(cached.items);
    if (usable && !force && Date.now() - cached.fetchedAt < QUEUE_TTL) return cached;
    try {
      const { items, errors } = parseQueue(await fetchCsv(sheetUrl));
      // Таблица скачалась, но ни одной годной строки и есть ошибки (переименовали колонку, сломали
      // формат) — прежний рабочий список не затираем. Пустая таблица без ошибок — честно пустая.
      if (items.length === 0 && errors.length > 0 && usable && cached.items.length > 0) {
        warn('Таблица без годных строк, оставлен прежний список:', errors);
        return { ...cached, errors: [...errors, 'в таблице нет годных строк — показан прежний список'] };
      }
      const queue = { url: sheetUrl, fetchedAt: Date.now(), items, errors };
      await storageSet(QUEUE_KEY, queue);
      return queue;
    } catch (error) {
      // Сеть недоступна — работаем по последнему удачному списку той же таблицы, но говорим об этом.
      warn('Не удалось загрузить таблицу:', error);
      if (usable)
        return {
          ...cached,
          errors: [...(cached.errors || []), `таблица недоступна (${error.message}) — старый список`],
        };
      throw error;
    }
  }

  // comment — тот, с которым займ реально закрыт; isDone сверяет его с текущей строкой таблицы.
  async function markDone(loanId, comment) {
    await storageSet(doneKey(loanId), { at: Date.now(), comment });
  }

  // Словарь { loanId: запись } для займов очереди — в форме, которую ждут isDone/progressOf/pickNext.
  async function readDone(items) {
    const records = await Promise.all(items.map((item) => storageGet(doneKey(item.loanId), null)));
    const done = {};
    items.forEach((item, index) => {
      if (records[index]) done[item.loanId] = records[index];
    });
    return done;
  }

  // Ожидание полной инициализации страницы (как в agis-bki-ban-note): ready-обработчики AGIS в конце
  // страницы вызывают $('.transition_select').change() → resetForm(), а флеш-плашки ещё не допарсены
  // на document-start. Поэтому window.load плюс один macrotask (ready-колбэки jQuery 3 асинхронны).
  // Это события окна, а не изменения DOM, поэтому здесь не MutationObserver.
  function pageReady() {
    const afterTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    if (document.readyState === 'complete') return afterTick();
    return new Promise((resolve) => window.addEventListener('load', resolve, { once: true })).then(afterTick);
  }

  // cleanupRoute() ядра снимает таймер и observer waitForCondition, но не завершает его промис —
  // без этой обёртки fillForm навсегда повис бы на await при «Обновить список» во время ожидания.
  function untilRouteAborted(promise) {
    const { signal } = routeAbort;
    if (signal.aborted) return Promise.resolve(null);
    return Promise.race([
      promise,
      new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true })),
    ]);
  }

  // waitForCondition с «мягким» таймаутом: вместо исключения — последняя проверка probe(). Поле
  // показывается сменой style (атрибут), а waitForCondition ловит только childList/characterData.
  async function waitOrLastCheck(probe, timeout, describe) {
    try {
      return await untilRouteAborted(waitForCondition(probe, { timeout, describe }));
    } catch {
      return probe() || null;
    }
  }

  // --- Панель ---------------------------------------------------------------

  function applyStyles(element, styles) {
    // setProperty(..., 'important') — админка AGIS (AdminLTE) агрессивно перекрывает стили кнопок.
    Object.entries(styles).forEach(([property, value]) => element.style.setProperty(property, value, 'important'));
  }

  function createPanel() {
    document.getElementById(PANEL_ID)?.remove();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    // Слева внизу: справа внизу живёт панель agis-deposit-refund.
    applyStyles(panel, {
      position: 'fixed',
      left: '24px',
      bottom: '24px',
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      'max-width': '380px',
      padding: '12px',
      border: '2px solid #d9534f',
      'border-radius': '6px',
      background: '#ffffff',
      color: '#222222',
      'font-family': 'Arial, sans-serif',
      'font-size': '14px',
      'box-shadow': '0 5px 22px rgba(0, 0, 0, 0.35)',
      'z-index': '2147483647',
      visibility: 'visible',
      opacity: '1',
    });
    document.body.appendChild(panel);
    return panel;
  }

  function addText(panel, text, styles = {}) {
    const line = document.createElement('div');
    line.textContent = text;
    applyStyles(line, styles);
    panel.appendChild(line);
    return line;
  }

  function addButton(panel, label, onClick, { primary = false, disabled = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    applyStyles(button, {
      display: 'block',
      padding: '8px 12px',
      border: `1px solid ${primary ? '#a94442' : '#adadad'}`,
      'border-radius': '4px',
      background: primary ? '#d9534f' : '#f5f5f5',
      color: primary ? '#ffffff' : '#222222',
      cursor: disabled ? 'not-allowed' : 'pointer',
      'font-family': 'Arial, sans-serif',
      'font-size': '14px',
      'font-weight': primary ? '700' : '400',
    });
    button.addEventListener('click', onClick);
    panel.appendChild(button);
    return button;
  }

  function loanUrl(route, loanId) {
    return `/admin/agis2/core/${route.section}/${loanId}/edit`;
  }

  async function promptSheetUrl() {
    const current = await storageGet(SHEET_URL_KEY, '');
    const url = window.prompt(
      'Ссылка на опубликованную Google Таблицу (CSV), колонки: loanid, reason, date, comment.\n' +
        'Пример: https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0',
      current,
    );
    if (url === null) return false;
    await storageSet(SHEET_URL_KEY, url.trim());
    await storageDelete(QUEUE_KEY);
    return true;
  }

  // Pending пишется с await сразу после заполнения ('armed'), а не только на submit: обработчик
  // submit не может дождаться GM_setValue, и запись могла бы потеряться при уходе со страницы.
  // На submit — лишь уточнение без await ('submitted' или удаление, если оператор сменил переход/
  // причину); если оно потеряется, 'armed' всё равно проверится после перезагрузки.
  async function armPending(form, route, item, reasonValue) {
    const key = pendingKey(route.loanId);
    const armed = { stage: 'armed', loanId: route.loanId, comment: item.comment, at: Date.now() };
    await storageSet(key, armed);
    if (!form) return;
    watchSubmit(form, reasonValue, {
      onOurs: () => storageSet(key, { ...armed, stage: 'submitted', at: Date.now() }),
      onOther: () => {
        log('Форма отправлена без принудительного закрытия или с другой причиной — займ не отмечаю');
        storageDelete(key);
      },
      signal: routeAbort.signal,
    });
  }

  // Заполнение формы: шаг 1 — переход, затем ждём, пока скрипт страницы покажет поля закрытия
  // с вариантами причин, шаг 2 — значения. Форму не отправляем.
  async function fillForm(route, item, token) {
    // До окончания загрузки ready-обработчики страницы сбросили бы заполненную форму.
    await untilRouteAborted(pageReady());
    if (!routeTokenController.isCurrent(token)) return;

    const closeDateTime = toCloseDateTime(item.date, new Date());
    if (closeDateTime === null) {
      showBanner(`Дата «${item.date}» в таблице некорректна или в будущем. Форма не заполнена.`, { type: 'error' });
      return;
    }

    const transition = selectTransition(document);
    if (!transition.ok) {
      showBanner(`Форма не заполнена: ${transition.problem}.`, { type: 'error', durationMs: 12000 });
      warn('Переход не выбран:', transition.problem);
      return;
    }

    // Ждём не только видимость поля, но и варианты причин: их может подгружать скрипт страницы.
    // По таймауту всё равно заполняем — fillCloseFields сам сообщит, чего не хватило.
    const reasonReady = await waitOrLastCheck(
      () => {
        const reasonField = document.querySelector('select.force_close_reason');
        return reasonField && reasonField.offsetParent !== null && reasonField.options.length > 1 ? reasonField : null;
      },
      5000,
      'поле причины с вариантами после выбора перехода',
    );
    if (!routeTokenController.isCurrent(token)) return;
    if (!reasonReady) warn('Поле причины не стало видимым или без вариантов — заполняю как есть');

    const { fields, problems } = fillCloseFields(document, {
      reason: item.reason,
      closeDateTime,
      comment: item.comment,
    });
    for (const field of [transition.field, ...fields]) {
      field.style.setProperty('outline', '3px solid #f0ad4e', 'important');
    }

    if (problems.length > 0) {
      // showBanner ядра — textContent без pre-line: переводы строк схлопнулись бы.
      showBanner(`Заполнено частично, НЕ отправляйте форму: ${problems.join('; ')}`, {
        type: 'error',
        durationMs: 15000,
      });
      warn('Проблемы заполнения:', problems);
      return;
    }

    const form = transition.field.closest('form');
    const reasonValue = document.querySelector('select.force_close_reason').value;
    if (!form) warn('Форма перехода не найдена — смену причины перед отправкой отследить не получится');
    await armPending(form, route, item, reasonValue);
    if (!routeTokenController.isCurrent(token)) return;

    showBanner(
      `Форма закрытия займа #${route.loanId} заполнена (${closeDateTime}, «${item.comment}», СМС снято). ` +
        'Проверьте и нажмите «Обновить» вручную.',
      { type: 'success', durationMs: 12000 },
    );
    log('Форма заполнена:', route.loanId, closeDateTime, item);
  }

  // После ручной отправки AGIS перезагружает карточку займа. Если перед этим наша форма была заполнена
  // (pending 'armed'/'submitted'), дожидаемся загрузки и плашки результата и отмечаем займ выполненным,
  // только если закрытие подтверждено сменой статуса (detectCloseResult === 'closed').
  async function resolvePending(route, token, pending) {
    // Запись одноразовая: удаляем сразу, F5 по той же странице не должен проверять её повторно.
    await storageDelete(pendingKey(route.loanId));
    if (!routeTokenController.isCurrent(token) || !isPendingUsable(pending, route.loanId)) return;

    await untilRouteAborted(pageReady());
    if (!routeTokenController.isCurrent(token)) return;
    const result = await waitOrLastCheck(() => detectCloseResult(document), 10000, 'плашка результата закрытия');
    if (!routeTokenController.isCurrent(token)) return;

    // Заполнили, но не отправили (F5/переход по ссылке): плашки нет — молча забываем заполнение.
    if (result === null && pending.stage === 'armed') {
      log('Форма была заполнена, но не отправлена — отметку не ставлю');
      return;
    }
    if (result === 'closed') {
      await markDone(route.loanId, pending.comment);
      if (!routeTokenController.isCurrent(token)) return;
      showBanner(`Займ #${route.loanId} закрыт и отмечен выполненным.`, { type: 'success' });
      return;
    }
    const message =
      result === 'error'
        ? `Закрытие займа #${route.loanId} не прошло — проверьте ошибки формы.`
        : `Не удалось подтвердить закрытие займа #${route.loanId}: проверьте статус и при необходимости ` +
          'отметьте выполненным вручную.';
    warn(message, { result });
    showBanner(message, { type: 'error', durationMs: 15000 });
  }

  async function renderPanel(route, queue, token) {
    const done = await readDone(queue.items);
    if (!routeTokenController.isCurrent(token)) return;

    const panel = createPanel();
    addText(panel, 'Закрытие займов из таблицы', { 'font-weight': '700', color: '#a94442' });

    const progress = progressOf(queue.items, done);
    addText(panel, `Выполнено ${progress.done} из ${progress.total}, осталось ${progress.left}`);
    if (queue.errors?.length > 0) {
      addText(panel, `Проблемы таблицы (${queue.errors.length}): ${queue.errors.slice(0, 3).join('; ')}`, {
        color: '#a94442',
        'font-size': '12px',
      });
    }

    const item = queue.items.find((entry) => entry.loanId === route.loanId);
    if (!item) {
      addText(panel, `Займа #${route.loanId} нет в таблице — закрытие не предлагается.`, { color: '#a94442' });
    } else if (isDone(done, item)) {
      addText(panel, `Займ #${route.loanId}: уже отмечен выполненным.`, { color: '#198754' });
    } else {
      addText(panel, `Займ #${route.loanId}: ${item.reason}, ${item.date}, «${item.comment}»`, { 'font-size': '12px' });
      addButton(
        panel,
        'Заполнить закрытие',
        debounce(() => fillForm(route, item, token).catch((error) => warn('Ошибка заполнения:', error)), 400),
        { primary: true },
      );
      addButton(panel, 'Отметить выполненным', async () => {
        if (!window.confirm(`Отметить займ #${route.loanId} выполненным вручную?`)) return;
        await markDone(item.loanId, item.comment);
        rebootstrap();
      });
    }

    const next = pickNext(queue.items, done, route.loanId);
    addButton(
      panel,
      next ? `Следующий: #${next.loanId} →` : 'Невыполненных займов нет',
      () => {
        if (next) location.assign(loanUrl(route, next.loanId));
      },
      { disabled: !next },
    );
    addButton(panel, 'Обновить список', async () => {
      const sheetUrl = await storageGet(SHEET_URL_KEY, '');
      if (sheetUrl) await loadQueue(sheetUrl, true).catch((error) => warn('Обновление не удалось:', error));
      rebootstrap();
    });
    addText(panel, 'Форма заполняется, но не отправляется: кнопку «Обновить» нажимаете вы.', {
      'font-size': '12px',
      color: '#666666',
    });
  }

  async function renderSetupPanel(message) {
    const panel = createPanel();
    addText(panel, 'Закрытие займов из таблицы', { 'font-weight': '700', color: '#a94442' });
    addText(panel, message);
    addButton(
      panel,
      'Задать ссылку на таблицу',
      async () => {
        if (await promptSheetUrl()) rebootstrap();
      },
      { primary: true },
    );
  }

  // --- Точка входа ----------------------------------------------------------

  async function bootstrap() {
    cleanupRoute();
    routeAbort.abort();
    routeAbort = new AbortController();
    const token = routeTokenController.next();
    const route = parseRoute(location.pathname);
    log('Запуск', { url: location.href, route });
    if (!route) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    await waitForCondition(() => document.body, { timeout: WAIT_TIMEOUT, describe: 'body' });
    if (!routeTokenController.isCurrent(token)) return;

    const sheetUrl = await storageGet(SHEET_URL_KEY, '');
    if (!routeTokenController.isCurrent(token)) return;
    if (!sheetUrl) {
      await renderSetupPanel('Не задана ссылка на Google Таблицу со списком займов.');
      return;
    }

    let queue;
    try {
      queue = await loadQueue(sheetUrl, false);
    } catch (error) {
      if (!routeTokenController.isCurrent(token)) return;
      await renderSetupPanel(`Не удалось загрузить таблицу: ${error.message}`);
      return;
    }
    if (!routeTokenController.isCurrent(token)) return;

    // Панель сразу, проверка результата — следом: она ждёт загрузки страницы, а затем перерисовывает
    // панель с новым прогрессом.
    await renderPanel(route, queue, token);
    if (!routeTokenController.isCurrent(token)) return;
    const pending = await storageGet(pendingKey(route.loanId), null);
    if (!pending || !routeTokenController.isCurrent(token)) return;
    await resolvePending(route, token, pending);
    if (!routeTokenController.isCurrent(token)) return;
    await renderPanel(route, queue, token);
  }

  const rebootstrap = debounce(() => {
    bootstrap().catch((error) => warn('Ошибка переинициализации:', error));
  }, 150);

  GM_registerMenuCommand('Закрытие займов: задать ссылку на таблицу', async () => {
    if (await promptSheetUrl()) rebootstrap();
  });
  GM_registerMenuCommand('Закрытие займов: сбросить отметки «выполнено»', async () => {
    const queue = await storageGet(QUEUE_KEY, null);
    const items = Array.isArray(queue?.items) ? queue.items : [];
    if (!window.confirm(`Сбросить отметки «выполнено» для ${items.length} займов текущего списка (${HOST})?`)) return;
    await Promise.all(items.map((item) => storageDelete(doneKey(item.loanId))));
    rebootstrap();
  });

  // onUrlChange — синхронно, до любых await: стоп-функция нужна pagehide-обработчику.
  const stopUrlWatcher = onUrlChange(() => rebootstrap());

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
    debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    await bootstrap();
  })().catch((error) => warn('Ошибка запуска:', error));
})();
