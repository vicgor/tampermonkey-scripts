// ==UserScript==
// @name         AGIS Инфо о займе (все страницы)
// @namespace    agis.loaninfo
// @version      5.1
// @description  Полноширинная строка под навбаром с информацией о займе и цветным статусом
// @icon         https://agis.creditsmile.ru/favicon.ico
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan*
// @match        https://agis.credit7.ru/admin/agis2/core/loan*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan*
// @match        https://agis.credit365.ru/admin/agis2/core/loan*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-info-navbar.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-info-navbar.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.1.0/lib/agis-core.js#sha256=mrgmLBDYkBLsL/GI0rVsuHT8V8QjzhXSEneovVOIL4Y=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      agis.creditsmile.ru
// @connect      agis.credit7.ru
// @connect      agis.belkacredit.ru
// @connect      agis.berrycash.ru
// @connect      agis.credit365.ru
// @connect      agis.volgazaim.ru
// @connect      agis.moneymania.ru
// ==/UserScript==

(function () {
    'use strict';

    if (!window.__AGIS_CORE__) {
        console.error('[agis:loan-info] agis-core.js не загружен (@require не сработал)');
        return;
    }

    const {
        debounce,
        cleanupRoute: coreCleanupRoute,
        cleanup,
        storageGet,
        storageSetDebounced,
        waitForElement,
        api,
        onUrlChange,
        createRouteTokenController,
    } = window.__AGIS_CORE__;

    // Стандарт репо: SCRIPT_NS = agis:<feature> (для лога и storage), DOM_NS — без двоеточия (для CSS/id).
    const SCRIPT_NS    = 'agis:loan-info';
    const DOM_NS       = 'agis-loan-info';
    // BAR_ID остаётся в прежнем виде — не трогаем CSS-селекторы, которые могут быть в коде.
    const BAR_ID       = 'cs-loan-bar';
    // Fallback-цепочка: пробуем селекторы по очереди, возвращаем первый найденный
    const NAVBAR_SELECTORS = [
        '.navbar-static-top',
        '.top-navbar',
        'header.navbar',
        '#content',
    ];
    const CACHE_TTL    = 5 * 60 * 1000;
    // v45 — bump вместе со сменой префикса ключа кэша (SCRIPT_NAME → SCRIPT_NS).
    // Старые ключи `CreditSmileLoanInfo:*:v44` останутся висеть в GM-storage как мёртвый балласт,
    // но пользователь не почувствует — TTL всего 5 минут, кэш наполнится заново при первом визите.
    const CACHE_VERSION = 'v45';
    const WAIT_TIMEOUT = 20000;

    const routeTokenController = createRouteTokenController();
    let lastRenderSignature = '';

    // Ссылка на функцию отключения единственного table-observerа, чтобы чистить при cleanupRoute.
    // Не входит в общий observers ядра (см. core-template.user.js, паттерн stopExtraObserver).
    let stopTableObserver = null;

    const STATUS_RED = new Set([
        'просроченный', 'аннулирован', 'продан',
        'подготовка к продаже',
        'инициирована судебная работа', 'в судебной работе',
        'судебная работа завершена', 'исполнительное производство', 'в работе ка',
    ]);
    const STATUS_GREY   = new Set(['кредит возвращен']);
    const STATUS_YELLOW = new Set([
        'процесс выдачи', 'в обработке', 'неудачная обработка',
        'ожидает назначения коллектора', 'новая заявка', 'заявка одобрена',
        'заявка подтверждена клиентом', 'ожидает подтверждения от клиента',
        'проблема верификации', 'ожидание суммы от клиента',
    ]);
    const STATUS_GREEN  = new Set(['активный кредит', 'продлен', 'в работе коллектора']);

    const RU_MONTHS = new Map([
        ['января','01'],['январь','01'],['янв.','01'],['янв','01'],
        ['февраля','02'],['февраль','02'],['февр.','02'],['февр','02'],['фев.','02'],['фев','02'],
        ['марта','03'],['март','03'],['мар.','03'],['мар','03'],
        ['апреля','04'],['апрель','04'],['апр.','04'],['апр','04'],
        ['мая','05'],['май','05'],
        ['июня','06'],['июнь','06'],['июн.','06'],['июн','06'],
        ['июля','07'],['июль','07'],['июл.','07'],['июл','07'],
        ['августа','08'],['август','08'],['авг.','08'],['авг','08'],
        ['сентября','09'],['сентябрь','09'],['сент.','09'],['сент','09'],['сен.','09'],['сен','09'],
        ['октября','10'],['октябрь','10'],['окт.','10'],['окт','10'],
        ['ноября','11'],['ноябрь','11'],['нояб.','11'],['нояб','11'],['ноя.','11'],['ноя','11'],
        ['декабря','12'],['декабрь','12'],['дек.','12'],['дек','12'],
    ]);

    // --- Утилиты ---

    // Дополняет cleanupRoute ядра: сам ядро чистит только свои waitForElement-observer'ы/таймеры,
    // table-observer и sig-состояние рендера — забота этого скрипта.
    function cleanupRoute() {
        coreCleanupRoute();
        if (stopTableObserver) { stopTableObserver(); stopTableObserver = null; }
        lastRenderSignature = '';
    }

    // --- DOM-ожидание ---

    // Fallback-поиск навбара: пробуем селекторы по очереди; если ни один не найден, логируем и бросаем ошибку
    function waitForNavbar() {
        return waitForElement(NAVBAR_SELECTORS.join(', '), { timeout: WAIT_TIMEOUT })
            .catch((err) => {
                console.warn(
                    `[${SCRIPT_NS}] Навбар не найден за ${WAIT_TIMEOUT} мс (${location.href}).`,
                    'Пробовались селекторы:', NAVBAR_SELECTORS.join(', ')
                );
                throw err;
            });
    }

    // Единственный MutationObserver для слежения за изменениями таблиц. Возвращает функцию отключения.
    // Реагирует только на НОВЫЕ узлы (в отличие от observeAddedElements ядра, не обрабатывает
    // существующий DOM при установке) — существующий контент уже разобран в bootstrap() напрямую.
    function observeTableChanges(callback) {
        const root = document.body || document.documentElement;
        if (!root) return () => {};

        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.matches?.('table, tbody, tr, th, td')) { callback(node); continue; }
                    const nested = node.querySelectorAll?.('table, tbody, tr, th, td');
                    if (!nested?.length) continue;
                    for (const el of nested) callback(el);
                }
            }
        });
        obs.observe(root, { childList: true, subtree: true });
        return () => obs.disconnect();
    }

    // --- Нормализация текста и дат ---

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }
    function pad2(v) { return String(v).padStart(2, '0'); }
    function toTwoDigitYear(year) {
        const s = String(year || '').trim();
        if (/^\d{4}$/.test(s)) return s.slice(-2);
        if (/^\d{2}$/.test(s)) return s;
        return null;
    }
    function isValidDateParts(d, m, y) {
        const dn = Number(d), mn = Number(m), yn = Number(y);
        if (!Number.isInteger(dn) || !Number.isInteger(mn) || !Number.isInteger(yn)) return false;
        return dn >= 1 && dn <= 31 && mn >= 1 && mn <= 12 && yn >= 0;
    }
    function buildShortDate(d, m, y) {
        if (!isValidDateParts(d, m, y)) return null;
        const yy = toTwoDigitYear(y);
        return yy ? `${pad2(d)}.${pad2(m)}.${yy}` : null;
    }

    function formatDateDDMMYY(value) {
        const text = normalizeText(value);
        if (!text) return null;

        // ISO: 2026-06-03
        const iso = text.match(/\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/);
        if (iso) return buildShortDate(iso[3], iso[2], iso[1]) || text;

        // Числовой: 03.06.2026
        const num = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
        if (num) return buildShortDate(num[1], num[2], num[3]) || text;

        // Текстовый AGIS: "13 февр. 2026 г." / "9 мар. 2026 г. на 24 дня"
        const txt = text.toLowerCase().match(/\b(\d{1,2})\s+((?:[а-яё]+\.?)+)\s+(\d{2,4})(?:\s*г\.?)?/u);
        if (txt) {
            const raw = txt[2].trim();
            const month = RU_MONTHS.get(raw) ?? RU_MONTHS.get(raw.replace(/\.$/, '') + '.') ?? RU_MONTHS.get(raw.replace(/\.$/, ''));
            if (month) return buildShortDate(txt[1], month, txt[3]) || text;
        }

        return text;
    }

    function applyDateFormatting(data) {
        const f = { ...data };
        f.issuedOn   = formatDateDDMMYY(f.issuedOn);
        f.dueDate    = formatDateDDMMYY(f.dueDate);
        f.extendedTo = formatDateDDMMYY(f.extendedTo);
        return compactData(f);
    }

    // --- URL / контекст ---

    function parseLoanContextFromUrl() {
        try {
            const url   = new URL(location.href);
            const match = url.pathname.match(
                /\/admin\/agis2\/core\/(loan(?:-(?:overdue|judicial-recovery|collection-agency))?)\/(\d+)(?:\/|$)/
            );
            if (!match) return null;
            return {
                host: url.host,
                section: match[1],
                id: match[2],
                cacheKey: `${SCRIPT_NS}:${url.host}:${match[1]}:${match[2]}:${CACHE_VERSION}`,
            };
        } catch (err) {
            console.warn(`[${SCRIPT_NS}] URL parse error:`, err);
            return null;
        }
    }

    // --- Парсинг документа ---

    function getRowCell(root, labelRegex) {
        for (const th of root.querySelectorAll('th')) {
            if (!labelRegex.test(normalizeText(th.textContent))) continue;
            const cell = th.closest('tr')?.querySelector('td');
            if (cell) return cell;
        }
        return null;
    }

    function getRowValue(root, labelRegex, { firstTextOnly = false } = {}) {
        const cell = getRowCell(root, labelRegex);
        if (!cell) return null;
        if (firstTextOnly) {
            for (const node of cell.childNodes) {
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const t = normalizeText(node.textContent);
                if (t) return t;
            }
        }
        return normalizeText(cell.textContent) || null;
    }

    function extractValue(text, key, stopRegex) {
        if (!text) return null;
        const idx = text.indexOf(key);
        if (idx === -1) return null;
        let rest = text.slice(idx + key.length).replace(/^[:\s]+/, '');
        const stop = rest.match(stopRegex);
        if (stop && stop.index > 0) rest = rest.slice(0, stop.index);
        return normalizeText(rest) || null;
    }

    function compactData(data) {
        const result = {};
        for (const [k, v] of Object.entries(data || {})) {
            const n = normalizeText(v);
            if (n) result[k] = n;
        }
        return result;
    }

    function hasUsefulData(data) {
        return !!data && Object.values(data).some(Boolean);
    }

    function parseDoc(doc) {
        const data = {};

        const sumCell = getRowValue(doc, /^Сумма$/);
        if (sumCell) {
            data.body  = extractValue(sumCell, 'Тело', /Вознаграждение|Сумма продл|Штраф|Депозит|Итого на сегодня|Итого|$/);
            data.total = extractValue(sumCell, 'Итого на сегодня', /$/);
        }
        if (!data.body) {
            const ci = getRowValue(doc, /^Общая информация по займу$/);
            if (ci) data.body = extractValue(ci, 'Сумма по договору:', /Срок|Количество|Ставка|Платеж|$/);
        }
        if (!data.total) {
            const cur = getRowValue(doc, /^Текущая информация по займу$/);
            if (cur) data.total = extractValue(cur, 'Итого задолженность:', /ДС на счету|$/);
        }

        const dc = getRowValue(doc, /^Дата$/);
        if (dc) {
            data.issuedOn    = extractValue(dc, 'Выдан:',        /Время выдачи|До:|Продлен|Итого|Просрочен|$/);
            data.dueDate     = extractValue(dc, 'До:',           /Продлен|Итого|Просрочен|$/);
            data.totalTerm   = extractValue(dc, 'Итого:',        /Просрочен|$/);
            data.overdueDays = extractValue(dc, 'Просрочен на:', /$/);
            data.extendedTo  = extractValue(dc, 'Продлен до:',   /Итого|Просрочен|$/);
        }

        data.priceList = getRowValue(doc, /^Прайслист$/);
        data.loanType  = getRowValue(doc, /^Тип$/);
        data.status    = getRowValue(doc, /^Статус\b/, { firstTextOnly: true });

        return applyDateFormatting(compactData(data));
    }

    // --- Кэш ---

    async function readCache(context) {
        const entry = await storageGet(context.cacheKey, null);
        if (!entry || typeof entry !== 'object') return null;
        if (!entry.timestamp || Date.now() - entry.timestamp > CACHE_TTL) return null;
        if (!hasUsefulData(entry.data)) return null;
        return applyDateFormatting(entry.data);
    }

    function writeCache(context, data) {
        const fd = applyDateFormatting(data);
        if (!hasUsefulData(fd)) return;
        storageSetDebounced(context.cacheKey, { timestamp: Date.now(), data: fd });
    }

    // --- Запрос к бэкенду (fallback когда DOM пустой и кеш устарел) ---
    // api.getHtml оборачивает GM_xmlhttpRequest, чтобы обойти CSP сайта.
    // URL абсолютный — context.host берётся из текущего location.
    async function fetchFromBackend(context) {
        const url = `https://${context.host}/admin/agis2/core/${context.section}/${context.id}/show`;
        let doc;
        try {
            ({ doc } = await api.getHtml(url));
        } catch (err) {
            throw new Error(`fetchFromBackend: ${err.message}`);
        }
        const data = parseDoc(doc);
        if (!hasUsefulData(data)) throw new Error(`fetchFromBackend: no useful data in /show response (${url})`);
        return data;
    }

    // --- Рендеринг ---

    function statusColor(status) {
        const s = normalizeText(status).toLowerCase();
        if (STATUS_RED.has(s))    return { bg: '#f2dede', fg: '#a94442', bd: '#ebccd1' };
        if (STATUS_GREY.has(s))   return { bg: '#e7e7e7', fg: '#555555', bd: '#d0d0d0' };
        if (STATUS_YELLOW.has(s)) return { bg: '#fcf8e3', fg: '#8a6d3b', bd: '#faebcc' };
        if (STATUS_GREEN.has(s))  return { bg: '#dff0d8', fg: '#3c763d', bd: '#d6e9c6' };
        return { bg: '#d9edf7', fg: '#31708f', bd: '#bce8f1' };
    }

    function applyItemBaseStyle(el) {
        Object.assign(el.style, {
            display: 'inline-flex', flexDirection: 'column',
            margin: '0 16px 0 0', lineHeight: '1.15', maxWidth: '280px',
        });
    }

    function createItem(label, value, { highlight = false } = {}) {
        if (!value) return null;
        const w = document.createElement('span');
        const l = document.createElement('span');
        const v = document.createElement('span');
        applyItemBaseStyle(w);
        Object.assign(l.style, {
            fontSize: '9px', color: highlight ? '#d9534f' : '#8a96a3',
            textTransform: 'uppercase', letterSpacing: '.4px',
        });
        Object.assign(v.style, {
            fontSize: '12px', color: highlight ? '#d9534f' : '#1c2733',
            fontWeight: highlight ? '700' : '600',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        });
        l.textContent = label; v.textContent = value;
        w.append(l, v); return w;
    }

    function createStatusItem(status) {
        if (!status) return null;
        const c = statusColor(status);
        const w = document.createElement('span');
        const l = document.createElement('span');
        const v = document.createElement('span');
        applyItemBaseStyle(w);
        Object.assign(l.style, { fontSize: '9px', color: '#8a96a3', textTransform: 'uppercase', letterSpacing: '.4px' });
        Object.assign(v.style, {
            fontSize: '12px', fontWeight: '700',
            color: c.fg, background: c.bg, border: `1px solid ${c.bd}`,
            borderRadius: '3px', padding: '1px 7px', whiteSpace: 'nowrap',
        });
        l.textContent = 'Статус'; v.textContent = status;
        w.append(l, v); return w;
    }

    function removeBar() { document.getElementById(BAR_ID)?.remove(); }

    function render(context, data, navbar) {
        if (!context || !hasUsefulData(data) || !navbar) return;
        const fd  = applyDateFormatting(data);
        const sig = JSON.stringify({ id: context.id, data: fd });
        if (sig === lastRenderSignature && document.getElementById(BAR_ID)) return;
        lastRenderSignature = sig;
        removeBar();

        const bar = document.createElement('div');
        bar.id = BAR_ID;
        Object.assign(bar.style, {
            width: '100%', boxSizing: 'border-box',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 0',
            padding: '6px 16px', background: '#eef3f8',
            borderTop: '1px solid #d6e0ea', borderBottom: '1px solid #d6e0ea',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
            position: 'relative', zIndex: '1000',
        });

        [
            createStatusItem(fd.status),
            createItem('Выдан',       fd.issuedOn),
            createItem('До',          fd.dueDate),
            createItem('Срок',        fd.totalTerm),
            createItem('Просрочка',   fd.overdueDays, { highlight: !!fd.overdueDays }),
            createItem('Продлен до',  fd.extendedTo),
            createItem('Тело',        fd.body),
            createItem('Итого',       fd.total),
            createItem('Прайслист',   fd.priceList),
            createItem('Тип',         fd.loanType),
            createItem('Займ',        `#${context.id}`),
        ].filter(Boolean).forEach(item => bar.appendChild(item));

        navbar.parentNode.insertBefore(bar, navbar.nextSibling);
    }

    // --- Инициализация ---

    async function refreshFromDocument(context, navbar) {
        const data = parseDoc(document);
        if (!hasUsefulData(data)) return false;
        writeCache(context, data);
        render(context, data, navbar);
        return true;
    }

    async function bootstrap(reason = 'start') {
        const token = routeTokenController.next();
        cleanupRoute(); // отключает в том числе старый stopTableObserver

        const context = parseLoanContextFromUrl();
        if (!context) { removeBar(); return; }

        try {
            // Ждём DOM — navbar может появиться позже таблицы или вовсе не сразу.
            // Проверку токена делаем ПОСЛЕ получения navbar: если URL успел смениться пока
            // мы ждали DOM, новый bootstrap уже инкрементировал routeToken и вызвал cleanupRoute.
            // В этом случае navbar уже получен, но рендерить данные старого маршрута не нужно.
            const navbar = await waitForNavbar();

            // Первая проверка токена: сразу после получения navbar, до любой работы с данными.
            if (!routeTokenController.isCurrent(token)) return;

            const parsed = await refreshFromDocument(context, navbar);

            // Вторая проверка токена: после асинхронного парсинга документа.
            if (!routeTokenController.isCurrent(token)) return;

            if (!parsed) {
                const cached = await readCache(context);
                // Третья проверка токена: после потенциально медленного GM_getValue.
                if (!routeTokenController.isCurrent(token)) return;

                if (cached) {
                    render(context, cached, navbar);
                } else {
                    // DOM пустой и кеш устарел — запрашиваем данные у бэкенда напрямую.
                    // Актуально когда страница открыта через AJAX-навигацию до того,
                    // как таблица появилась в DOM, а кеш уже истёк.
                    try {
                        const backendData = await fetchFromBackend(context);
                        // Четвёртая проверка токена: после сетевого запроса (самый долгий await).
                        if (!routeTokenController.isCurrent(token)) return;
                        writeCache(context, backendData);
                        render(context, backendData, navbar);
                    } catch (e) {
                        console.warn(`[${SCRIPT_NS}] backend fallback failed:`, e.message);
                    }
                }
            }

            // Единственный observer на изменения таблиц — перезапускает парсинг с debounce
            const delayedRefresh = debounce(async () => {
                if (!routeTokenController.isCurrent(token)) return;
                const ctx = parseLoanContextFromUrl();
                if (!ctx || ctx.cacheKey !== context.cacheKey) return;
                await refreshFromDocument(ctx, navbar);
            }, 300);

            stopTableObserver = observeTableChanges(delayedRefresh);
        } catch (err) {
            console.warn(`[${SCRIPT_NS}] init error (${reason}):`, err.message);
        }
    }

    const stopUrlWatcher = onUrlChange(() => bootstrap('url-change'));

    window.addEventListener('pagehide', () => {
        if (stopTableObserver) { stopTableObserver(); stopTableObserver = null; }
        cleanup();
        stopUrlWatcher();
    }, { once: true });

    bootstrap('document-start');
})();
