// ==UserScript==
// @name         CreditSmile — Инфо о займе (все страницы)
// @namespace    agis.loaninfo
// @version      4.0
// @description  Полноширинная строка под навбаром с информацией о займе и цветным статусом
// @icon         https://agis.creditsmile.ru/favicon.ico
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan*
// @match        https://agis.credit7.ru/admin/agis2/core/loan*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan*
// @match        https://agis.credit365.ru/admin/agis2/core/loan*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = 'CreditSmileLoanInfo';
    const BAR_ID = 'cs-loan-bar';
    const NAVBAR_SELECTOR = '.navbar-static-top';
    const CACHE_TTL = 5 * 60 * 1000;
    const CACHE_VERSION = 'v40';
    const WAIT_TIMEOUT = 20000;

    let routeToken = 0;
    let lastUrl = location.href;
    let lastRenderSignature = '';

    const observers = new Set();
    const timers = new Set();
    const storageTimers = new Map();

    const STATUS_RED = new Set([
        'просроченный',
        'аннулирован',
        'продан',
        'подготовка к продаже',
        'инициирована судебная работа',
        'в судебной работе',
        'судебная работа завершена',
        'исполнительное производство',
        'в работе ка',
    ]);

    const STATUS_GREY = new Set([
        'кредит возвращен',
    ]);

    const STATUS_YELLOW = new Set([
        'процесс выдачи',
        'в обработке',
        'неудачная обработка',
        'ожидает назначения коллектора',
        'новая заявка',
        'заявка одобрена',
        'заявка подтверждена клиентом',
        'ожидает подтверждения от клиента',
        'проблема верификации',
        'ожидание суммы от клиента',
    ]);

    const STATUS_GREEN = new Set([
        'активный кредит',
        'продлен',
        'в работе коллектора',
    ]);

    function setManagedTimeout(callback, delay) {
        const timer = setTimeout(() => {
            timers.delete(timer);
            callback();
        }, delay);

        timers.add(timer);
        return timer;
    }

    function cleanupRoute() {
        for (const observer of observers) observer.disconnect();
        observers.clear();

        for (const timer of timers) clearTimeout(timer);
        timers.clear();

        lastRenderSignature = '';
    }

    function debounce(fn, wait = 250) {
        let timer = null;

        function debounced(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        }

        debounced.cancel = () => {
            clearTimeout(timer);
            timer = null;
        };

        return debounced;
    }

    async function storageGet(key, fallback = null) {
        try {
            const value = await GM_getValue(key, fallback);
            return value === undefined ? fallback : value;
        } catch (err) {
            console.warn(`[${SCRIPT_NAME}] GM_getValue error:`, err);
            return fallback;
        }
    }

    function storageSetDebounced(key, value, wait = 300) {
        const oldTimer = storageTimers.get(key);
        if (oldTimer) clearTimeout(oldTimer);

        const timer = setTimeout(async () => {
            storageTimers.delete(key);

            try {
                await GM_setValue(key, value);
            } catch (err) {
                console.warn(`[${SCRIPT_NAME}] GM_setValue error:`, err);
            }
        }, wait);

        storageTimers.set(key, timer);
    }

    function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
        return new Promise((resolve, reject) => {
            let done = false;
            let observer = null;

            const query = () => {
                try {
                    return root.querySelector(selector);
                } catch (_) {
                    return null;
                }
            };

            const finish = (element) => {
                if (done) return;

                done = true;

                if (observer) {
                    observer.disconnect();
                    observers.delete(observer);
                }

                clearTimeout(timeoutTimer);
                timers.delete(timeoutTimer);

                resolve(element);
            };

            const fail = () => {
                if (done) return;

                done = true;

                if (observer) {
                    observer.disconnect();
                    observers.delete(observer);
                }

                reject(new Error(`waitForElement: ${selector} not found`));
            };

            const existing = query();
            if (existing) {
                resolve(existing);
                return;
            }

            const timeoutTimer = setManagedTimeout(fail, timeout);

            const startObserve = () => {
                if (done) return;

                const observeRoot = root === document
                    ? document.documentElement || document.body
                    : root;

                if (!observeRoot) {
                    setManagedTimeout(startObserve, 50);
                    return;
                }

                observer = new MutationObserver(() => {
                    const element = query();
                    if (element) finish(element);
                });

                observer.observe(observeRoot, {
                    childList: true,
                    subtree: true,
                });

                observers.add(observer);

                const element = query();
                if (element) finish(element);
            };

            startObserve();
        });
    }

    function observeAddedElements(selector, callback, { root = document } = {}) {
        const observeRoot = root === document
            ? document.documentElement || document.body
            : root;

        if (!observeRoot) return null;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    if (node.matches?.(selector)) {
                        callback(node);
                    }

                    const nested = node.querySelectorAll?.(selector);
                    if (!nested) continue;

                    for (const element of nested) callback(element);
                }
            }
        });

        observer.observe(observeRoot, {
            childList: true,
            subtree: true,
        });

        observers.add(observer);
        return observer;
    }

    function onUrlChange(callback) {
        const check = debounce(() => {
            if (location.href === lastUrl) return;

            lastUrl = location.href;
            callback(location.href);
        }, 100);

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            const result = originalPushState.apply(this, args);
            check();
            return result;
        };

        history.replaceState = function (...args) {
            const result = originalReplaceState.apply(this, args);
            check();
            return result;
        };

        window.addEventListener('popstate', check);
        window.addEventListener('hashchange', check);

        const interval = setInterval(check, 1000);

        return () => {
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
            window.removeEventListener('popstate', check);
            window.removeEventListener('hashchange', check);
            clearInterval(interval);
            check.cancel();
        };
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseLoanContextFromUrl() {
        try {
            const url = new URL(location.href);

            const match = url.pathname.match(
                /\/admin\/agis2\/core\/(loan(?:-(?:overdue|judicial-recovery|collection-agency))?)\/(\d+)(?:\/|$)/
            );

            if (!match) return null;

            return {
                host: url.host,
                section: match[1],
                id: match[2],
                cacheKey: `${SCRIPT_NAME}:${url.host}:${match[1]}:${match[2]}:${CACHE_VERSION}`,
            };
        } catch (err) {
            console.warn(`[${SCRIPT_NAME}] URL parse error:`, err);
            return null;
        }
    }

    function getRowCell(root, labelRegex) {
        const headers = root.querySelectorAll('th');

        for (const th of headers) {
            const label = normalizeText(th.textContent);

            if (!labelRegex.test(label)) continue;

            const row = th.closest('tr');
            const cell = row?.querySelector('td');

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

                const text = normalizeText(node.textContent);
                if (text) return text;
            }
        }

        return normalizeText(cell.textContent) || null;
    }

    function extractValue(text, key, stopRegex) {
        if (!text) return null;

        const index = text.indexOf(key);
        if (index === -1) return null;

        let rest = text.slice(index + key.length).replace(/^[:\s]+/, '');
        const stop = rest.match(stopRegex);

        if (stop && stop.index > 0) {
            rest = rest.slice(0, stop.index);
        }

        return normalizeText(rest) || null;
    }

    function compactData(data) {
        const result = {};

        for (const [key, value] of Object.entries(data || {})) {
            const normalized = normalizeText(value);
            if (normalized) result[key] = normalized;
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
            data.body = extractValue(
                sumCell,
                'Тело',
                /Вознаграждение|Сумма продл|Штраф|Депозит|Итого на сегодня|Итого|$/
            );

            data.total = extractValue(
                sumCell,
                'Итого на сегодня',
                /$/
            );
        }

        if (!data.body) {
            const contractInfo = getRowValue(doc, /^Общая информация по займу$/);

            if (contractInfo) {
                data.body = extractValue(
                    contractInfo,
                    'Сумма по договору:',
                    /Срок|Количество|Ставка|Платеж|$/
                );
            }
        }

        if (!data.total) {
            const currentInfo = getRowValue(doc, /^Текущая информация по займу$/);

            if (currentInfo) {
                data.total = extractValue(
                    currentInfo,
                    'Итого задолженность:',
                    /ДС на счету|$/
                );
            }
        }

        const dateCell = getRowValue(doc, /^Дата$/);
        if (dateCell) {
            data.issuedOn = extractValue(
                dateCell,
                'Выдан:',
                /Время выдачи|До:|Продлен|Итого|Просрочен|$/
            );

            data.dueDate = extractValue(
                dateCell,
                'До:',
                /Продлен|Итого|Просрочен|$/
            );

            data.totalTerm = extractValue(
                dateCell,
                'Итого:',
                /Просрочен|$/
            );

            data.overdueDays = extractValue(
                dateCell,
                'Просрочен на:',
                /$/
            );

            data.extendedTo = extractValue(
                dateCell,
                'Продлен до:',
                /Итого|Просрочен|$/
            );
        }

        data.priceList = getRowValue(doc, /^Прайслист$/);
        data.loanType = getRowValue(doc, /^Тип$/);
        data.status = getRowValue(doc, /^Статус\b/, { firstTextOnly: true });

        return compactData(data);
    }

    async function readCache(context) {
        const entry = await storageGet(context.cacheKey, null);

        if (!entry || typeof entry !== 'object') return null;
        if (!entry.timestamp || Date.now() - entry.timestamp > CACHE_TTL) return null;
        if (!hasUsefulData(entry.data)) return null;

        return entry.data;
    }

    function writeCache(context, data) {
        if (!hasUsefulData(data)) return;

        storageSetDebounced(context.cacheKey, {
            timestamp: Date.now(),
            data,
        });
    }

    function statusColor(status) {
        const normalized = normalizeText(status).toLowerCase();

        if (STATUS_RED.has(normalized)) {
            return { bg: '#f2dede', fg: '#a94442', bd: '#ebccd1' };
        }

        if (STATUS_GREY.has(normalized)) {
            return { bg: '#e7e7e7', fg: '#555555', bd: '#d0d0d0' };
        }

        if (STATUS_YELLOW.has(normalized)) {
            return { bg: '#fcf8e3', fg: '#8a6d3b', bd: '#faebcc' };
        }

        if (STATUS_GREEN.has(normalized)) {
            return { bg: '#dff0d8', fg: '#3c763d', bd: '#d6e9c6' };
        }

        return { bg: '#d9edf7', fg: '#31708f', bd: '#bce8f1' };
    }

    function applyItemBaseStyle(wrapper) {
        Object.assign(wrapper.style, {
            display: 'inline-flex',
            flexDirection: 'column',
            margin: '0 16px 0 0',
            lineHeight: '1.15',
            maxWidth: '280px',
        });
    }

    function createItem(label, value, { highlight = false } = {}) {
        if (!value) return null;

        const wrapper = document.createElement('span');
        const labelEl = document.createElement('span');
        const valueEl = document.createElement('span');

        applyItemBaseStyle(wrapper);

        Object.assign(labelEl.style, {
            fontSize: '9px',
            color: highlight ? '#d9534f' : '#8a96a3',
            textTransform: 'uppercase',
            letterSpacing: '.4px',
        });

        Object.assign(valueEl.style, {
            fontSize: '12px',
            color: highlight ? '#d9534f' : '#1c2733',
            fontWeight: highlight ? '700' : '600',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        });

        labelEl.textContent = label;
        valueEl.textContent = value;

        wrapper.append(labelEl, valueEl);
        return wrapper;
    }

    function createStatusItem(status) {
        if (!status) return null;

        const colors = statusColor(status);
        const wrapper = document.createElement('span');
        const labelEl = document.createElement('span');
        const valueEl = document.createElement('span');

        applyItemBaseStyle(wrapper);

        Object.assign(labelEl.style, {
            fontSize: '9px',
            color: '#8a96a3',
            textTransform: 'uppercase',
            letterSpacing: '.4px',
        });

        Object.assign(valueEl.style, {
            fontSize: '12px',
            fontWeight: '700',
            color: colors.fg,
            background: colors.bg,
            border: `1px solid ${colors.bd}`,
            borderRadius: '3px',
            padding: '1px 7px',
            whiteSpace: 'nowrap',
        });

        labelEl.textContent = 'Статус';
        valueEl.textContent = status;

        wrapper.append(labelEl, valueEl);
        return wrapper;
    }

    function removeBar() {
        document.getElementById(BAR_ID)?.remove();
    }

    function render(context, data, navbar) {
        if (!context || !hasUsefulData(data) || !navbar) return;

        const signature = JSON.stringify({
            id: context.id,
            data,
        });

        if (signature === lastRenderSignature && document.getElementById(BAR_ID)) {
            return;
        }

        lastRenderSignature = signature;
        removeBar();

        const bar = document.createElement('div');
        bar.id = BAR_ID;

        Object.assign(bar.style, {
            width: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '4px 0',
            padding: '6px 16px',
            background: '#eef3f8',
            borderTop: '1px solid #d6e0ea',
            borderBottom: '1px solid #d6e0ea',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
            position: 'relative',
            zIndex: '1000',
        });

        const items = [
            createStatusItem(data.status),
            createItem('Выдан', data.issuedOn),
            createItem('До', data.dueDate),
            createItem('Срок', data.totalTerm),
            createItem('Просрочка', data.overdueDays, { highlight: !!data.overdueDays }),
            createItem('Продлен до', data.extendedTo),
            createItem('Тело', data.body),
            createItem('Итого', data.total),
            createItem('Прайслист', data.priceList),
            createItem('Тип', data.loanType),
            createItem('Займ', `#${context.id}`),
        ].filter(Boolean);

        for (const item of items) {
            bar.appendChild(item);
        }

        navbar.parentNode.insertBefore(bar, navbar.nextSibling);
    }

    async function refreshFromDocument(context, navbar) {
        const data = parseDoc(document);

        if (!hasUsefulData(data)) {
            return false;
        }

        writeCache(context, data);
        render(context, data, navbar);
        return true;
    }

    async function bootstrap(reason = 'start') {
        const token = ++routeToken;
        cleanupRoute();

        const context = parseLoanContextFromUrl();

        if (!context) {
            removeBar();
            return;
        }

        try {
            const navbar = await waitForElement(NAVBAR_SELECTOR);

            if (token !== routeToken) return;

            const parsed = await refreshFromDocument(context, navbar);

            if (!parsed) {
                const cached = await readCache(context);

                if (token !== routeToken) return;

                if (cached) {
                    render(context, cached, navbar);
                }
            }

            const delayedRefresh = debounce(async () => {
                if (token !== routeToken) return;

                const currentContext = parseLoanContextFromUrl();

                if (!currentContext || currentContext.cacheKey !== context.cacheKey) {
                    return;
                }

                await refreshFromDocument(currentContext, navbar);
            }, 300);

            observeAddedElements('table, tbody, tr, th, td', delayedRefresh);
        } catch (err) {
            console.warn(`[${SCRIPT_NAME}] init error:`, reason, err);
        }
    }

    const stopUrlWatcher = onUrlChange(() => {
        bootstrap('url-change');
    });

    window.addEventListener('pagehide', () => {
        cleanupRoute();
        stopUrlWatcher();

        for (const timer of storageTimers.values()) {
            clearTimeout(timer);
        }

        storageTimers.clear();
    }, { once: true });

    bootstrap('document-start');
})();