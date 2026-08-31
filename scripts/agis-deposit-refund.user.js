// ==UserScript==
// @name         AGIS — возврат депозита
// @namespace    https://github.com/vicgor/tampermonkey-scripts
// @version      1.3.0
// @description  Находит ДС на счету и подготавливает возврат депозита
// @author       Victor Goryachko
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
    'use strict';

    const LOG_PREFIX = '[AGIS Deposit Refund]';
    const PANEL_ID = 'tm-agis-deposit-panel';
    const STORAGE_PREFIX = 'agisDepositRefund';
    const WAIT_TIMEOUT = 30000;
    const PAYLOAD_TTL = 15 * 60 * 1000;

    let routeController = null;
    let urlObserver = null;
    let lastUrl = location.href;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(LOG_PREFIX, ...args);
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/[\u00a0\u202f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeComparable(value) {
        return normalizeText(value).toLocaleLowerCase('ru-RU');
    }

    function getRoute() {
        const match = location.pathname.match(
            /^\/admin\/agis2\/core\/loan\/(\d+)\/(edit|loantransaction\/create)\/?$/
        );

        if (!match) {
            return null;
        }

        return {
            loanId: match[1],
            page: match[2] === 'edit' ? 'edit' : 'create'
        };
    }

    function getStorageKey(loanId) {
        return `${STORAGE_PREFIX}:${loanId}`;
    }

    const storage = {
        async get(key, fallback = null) {
            try {
                return await GM_getValue(key, fallback);
            } catch (error) {
                warn(`Ошибка чтения ${key}:`, error);
                return fallback;
            }
        },

        async set(key, value) {
            try {
                await GM_setValue(key, value);
                return true;
            } catch (error) {
                warn(`Ошибка записи ${key}:`, error);
                return false;
            }
        },

        async remove(key) {
            try {
                await GM_deleteValue(key);
                return true;
            } catch (error) {
                warn(`Ошибка удаления ${key}:`, error);
                return false;
            }
        }
    };

    /*
     * Ждёт результат функции finder. MutationObserver учитывает динамическую
     * загрузку содержимого после document-start.
     */
    function waitForElement(finder, options = {}) {
        const timeout = options.timeout || WAIT_TIMEOUT;
        const signal = options.signal;

        return new Promise((resolve, reject) => {
            let observer = null;
            let timerId = null;
            let finished = false;

            function cleanup() {
                if (observer) {
                    observer.disconnect();
                }

                if (timerId) {
                    clearTimeout(timerId);
                }

                if (signal) {
                    signal.removeEventListener('abort', onAbort);
                }
            }

            function finish(callback, value) {
                if (finished) {
                    return;
                }

                finished = true;
                cleanup();
                callback(value);
            }

            function check() {
                try {
                    const result = typeof finder === 'function'
                        ? finder()
                        : document.querySelector(finder);

                    if (result) {
                        finish(resolve, result);
                    }
                } catch (error) {
                    finish(reject, error);
                }
            }

            function onAbort() {
                finish(
                    reject,
                    new DOMException('Ожидание отменено', 'AbortError')
                );
            }

            if (signal && signal.aborted) {
                onAbort();
                return;
            }

            check();

            if (finished) {
                return;
            }

            observer = new MutationObserver(check);
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });

            timerId = setTimeout(() => {
                finish(
                    reject,
                    new Error(`Элемент не найден за ${timeout} мс`)
                );
            }, timeout);

            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    function parseMoneyToKopecks(value) {
        const normalized = normalizeText(value)
            .replace(/[₽рР]/g, '')
            .replace(/\s/g, '')
            .replace(',', '.');

        const match = normalized.match(/-?\d+(?:\.\d{1,2})?/);

        if (!match) {
            return null;
        }

        const amount = Number(match[0]);

        if (!Number.isFinite(amount)) {
            return null;
        }

        return Math.round(amount * 100);
    }

    function formatRubles(kopecks) {
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(kopecks / 100);
    }

    function formatAmountForInput(kopecks) {
        return (kopecks / 100).toFixed(2);
    }

    function findDeposit() {
        if (!document.body) {
            return null;
        }

        const text = document.body.innerText || document.body.textContent || '';

        const match = text.match(
            /ДС\s*на\s*счету\s*:?\s*(-?[\d\s\u00a0\u202f]+(?:[,.]\d{1,2})?)\s*₽/iu
        );

        if (!match) {
            return null;
        }

        const kopecks = parseMoneyToKopecks(match[1]);

        if (kopecks === null) {
            return null;
        }

        return {
            kopecks,
            sourceText: match[0]
        };
    }

    function applyStyles(element, styles) {
        Object.entries(styles).forEach(([property, value]) => {
            element.style.setProperty(property, value, 'important');
        });
    }

    function createPanel() {
        const oldPanel = document.getElementById(PANEL_ID);

        if (oldPanel) {
            oldPanel.remove();
        }

        const panel = document.createElement('div');
        panel.id = PANEL_ID;

        applyStyles(panel, {
            position: 'fixed',
            right: '24px',
            bottom: '24px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '8px',
            width: 'auto',
            'max-width': '380px',
            padding: '12px',
            border: '2px solid #337ab7',
            'border-radius': '6px',
            background: '#ffffff',
            color: '#222222',
            'font-family': 'Arial, sans-serif',
            'font-size': '14px',
            'box-shadow': '0 5px 22px rgba(0, 0, 0, 0.35)',
            'z-index': '2147483647',
            visibility: 'visible',
            opacity: '1'
        });

        document.body.appendChild(panel);
        return panel;
    }

    function createEditPageButton(route, deposit, signal) {
        const panel = createPanel();

        const title = document.createElement('strong');
        title.textContent = 'Tampermonkey: депозит найден';

        applyStyles(title, {
            color: '#198754'
        });

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent =
            `Вернуть депозит ${formatRubles(deposit.kopecks)}`;

        applyStyles(button, {
            display: 'block',
            padding: '9px 14px',
            border: '1px solid #204d74',
            'border-radius': '4px',
            background: '#337ab7',
            color: '#ffffff',
            cursor: 'pointer',
            'font-family': 'Arial, sans-serif',
            'font-size': '14px',
            'font-weight': '700'
        });

        const message = document.createElement('div');

        applyStyles(message, {
            display: 'none',
            color: '#555555'
        });

        panel.appendChild(title);
        panel.appendChild(button);
        panel.appendChild(message);

        if (deposit.kopecks <= 0) {
            button.disabled = true;
            button.textContent = 'Депозит отсутствует';
            return;
        }

        button.addEventListener(
            'click',
            async () => {
                const confirmed = window.confirm(
                    `Подготовить возврат депозита `
                    + `${formatRubles(deposit.kopecks)} `
                    + `по займу #${route.loanId}?\n\n`
                    + 'Форма будет заполнена, но не отправлена автоматически.'
                );

                if (!confirmed || signal.aborted) {
                    return;
                }

                button.disabled = true;
                message.textContent = 'Открываю форму транзакции…';
                message.style.setProperty('display', 'block', 'important');

                const payload = {
                    loanId: route.loanId,
                    kopecks: deposit.kopecks,
                    createdAt: Date.now(),
                    sourceUrl: location.href
                };

                const saved = await storage.set(
                    getStorageKey(route.loanId),
                    payload
                );

                if (!saved) {
                    button.disabled = false;
                    message.textContent =
                        'Не удалось сохранить сумму. См. Console.';
                    message.style.setProperty(
                        'color',
                        '#b02a37',
                        'important'
                    );
                    return;
                }

                location.assign(
                    `/admin/agis2/core/loan/${route.loanId}`
                    + '/loantransaction/create'
                );
            },
            { signal }
        );

        log(
            'Кнопка добавлена:',
            route.loanId,
            deposit.sourceText,
            formatRubles(deposit.kopecks)
        );
    }

    async function initEditPage(route, signal) {
        try {
            const deposit = await waitForElement(findDeposit, { signal });
            createEditPageButton(route, deposit, signal);
        } catch (error) {
            if (error.name !== 'AbortError') {
                warn('Не удалось найти «ДС на счету»:', error);
            }
        }
    }

    function getFieldText(field) {
        const parts = [
            field.name,
            field.id,
            field.placeholder,
            field.getAttribute('aria-label')
        ];

        if (field.id) {
            try {
                const label = document.querySelector(
                    `label[for="${CSS.escape(field.id)}"]`
                );

                if (label) {
                    parts.push(label.textContent);
                }
            } catch (error) {
                warn('Ошибка поиска label:', error);
            }
        }

        const group = field.closest(
            '.form-group, .control-group, .field, tr, td'
        );

        if (group) {
            const label = group.querySelector(
                'label, th, .control-label, .field-label'
            );

            if (label) {
                parts.push(label.textContent);
            }
        }

        return normalizeComparable(parts.filter(Boolean).join(' '));
    }

    function findBestField(selector, patterns) {
        const candidates = Array.from(
            document.querySelectorAll(selector)
        );

        let bestField = null;
        let bestScore = 0;

        for (const field of candidates) {
            const description = getFieldText(field);
            let score = 0;

            for (const pattern of patterns) {
                if (pattern.test(description)) {
                    score += 10;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestField = field;
            }
        }

        return bestField;
    }

    function findAmountField() {
        return findBestField(
            'input:not([type]), input[type="text"], input[type="number"]',
            [
                /amount/iu,
                /(^|\W)sum(\W|$)/iu,
                /сумм/iu
            ]
        );
    }

    function findDirectionField() {
        return findBestField(
            'select, input[type="radio"]',
            [
                /direction/iu,
                /направлен/iu
            ]
        );
    }

    function findTransactionTypeField() {
        return findBestField(
            'select, input[type="radio"], input[type="text"]',
            [
                /transaction.*type/iu,
                /type.*transaction/iu,
                /тип.*транзакц/iu,
                /тип операции/iu
            ]
        );
    }

    function dispatchFieldEvents(field) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function setFieldValue(field, value) {
        field.value = value;
        dispatchFieldEvents(field);
    }

    function setChoice(field, desiredText) {
        const desired = normalizeComparable(desiredText);

        if (field instanceof HTMLSelectElement) {
            const options = Array.from(field.options);

            const option = options.find((item) => {
                const optionText = normalizeComparable(item.textContent);
                const optionValue = normalizeComparable(item.value);

                return optionText === desired
                    || optionValue === desired
                    || optionText.includes(desired);
            });

            if (!option) {
                return false;
            }

            field.value = option.value;
            dispatchFieldEvents(field);
            return true;
        }

        if (
            field instanceof HTMLInputElement
            && field.type === 'radio'
        ) {
            const selector = field.name
                ? `input[type="radio"][name="${CSS.escape(field.name)}"]`
                : null;

            const radios = selector
                ? Array.from(document.querySelectorAll(selector))
                : [field];

            const target = radios.find((radio) => {
                const value = normalizeComparable(radio.value);
                const parentText = normalizeComparable(
                    radio.parentElement
                        ? radio.parentElement.textContent
                        : ''
                );

                return value === desired
                    || parentText.includes(desired);
            });

            if (!target) {
                return false;
            }

            target.checked = true;
            dispatchFieldEvents(target);
            return true;
        }

        setFieldValue(field, desiredText);
        return true;
    }

    function showFormNotice(payload) {
        const panel = createPanel();

        const title = document.createElement('strong');
        title.textContent =
            `Возврат депозита: ${formatRubles(payload.kopecks)}`;

        const message = document.createElement('div');
        message.textContent = 'Определяю поля формы…';

        panel.appendChild(title);
        panel.appendChild(message);

        return message;
    }

    async function initCreatePage(route, signal) {
        const key = getStorageKey(route.loanId);
        const payload = await storage.get(key);

        if (!payload || payload.loanId !== route.loanId) {
            log('Для этого займа нет подготовленного возврата.');
            return;
        }

        const expired =
            Date.now() - payload.createdAt > PAYLOAD_TTL;

        if (expired || payload.kopecks <= 0) {
            await storage.remove(key);
            warn('Сохранённые данные возврата устарели.');
            return;
        }

        const message = showFormNotice(payload);

        try {
            const fields = await Promise.all([
                waitForElement(findAmountField, { signal }),
                waitForElement(findDirectionField, { signal }),
                waitForElement(findTransactionTypeField, { signal })
            ]);

            const amountField = fields[0];
            const directionField = fields[1];
            const typeField = fields[2];

            setFieldValue(
                amountField,
                formatAmountForInput(payload.kopecks)
            );

            const directionSet = setChoice(directionField, 'OUT');
            const typeSet = setChoice(
                typeField,
                'Возврат депозита'
            );

            [amountField, directionField, typeField].forEach((field) => {
                field.style.setProperty(
                    'outline',
                    '3px solid #f0ad4e',
                    'important'
                );
            });

            if (!directionSet || !typeSet) {
                message.textContent =
                    'Не все поля установлены. Проверьте сумму, OUT и тип.';
                message.style.setProperty(
                    'color',
                    '#b02a37',
                    'important'
                );
                return;
            }

            message.textContent =
                'Форма заполнена. Проверьте и отправьте вручную.';
            message.style.setProperty(
                'color',
                '#198754',
                'important'
            );

            // Данные удаляются после успешного заполнения формы.
            await storage.remove(key);
        } catch (error) {
            if (error.name !== 'AbortError') {
                message.textContent =
                    'Не удалось найти поля формы. См. Console.';
                message.style.setProperty(
                    'color',
                    '#b02a37',
                    'important'
                );
                warn('Ошибка заполнения формы:', error);
            }
        }
    }

    async function bootstrap() {
        if (routeController) {
            routeController.abort();
        }

        routeController = new AbortController();

        const route = getRoute();

        log('Запуск', {
            url: location.href,
            route
        });

        if (!route) {
            return;
        }

        if (route.page === 'edit') {
            await initEditPage(route, routeController.signal);
        } else {
            await initCreatePage(route, routeController.signal);
        }
    }

    /*
     * Простое наблюдение за SPA-навигацией. Если приложение заменит URL через
     * History API, MutationObserver заметит изменение документа и перезапустит
     * обработку для нового адреса.
     */
    function onUrlChange() {
        urlObserver = new MutationObserver(() => {
            if (location.href === lastUrl) {
                return;
            }

            lastUrl = location.href;

            bootstrap().catch((error) => {
                warn('Ошибка SPA-переинициализации:', error);
            });
        });

        urlObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function cleanup() {
        if (routeController) {
            routeController.abort();
        }

        if (urlObserver) {
            urlObserver.disconnect();
        }
    }

    function start() {
        bootstrap().catch((error) => {
            warn('Ошибка запуска:', error);
        });

        onUrlChange();
    }

    window.addEventListener('pagehide', cleanup, { once: true });

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            start,
            { once: true }
        );
    } else {
        start();
    }
})();