// ==UserScript==
// @name         AGIS Очистка вставки в поля суммы (_income и amount)
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Очищает вставку в полях суммы: оставляет только цифры, точки и запятые; первый и последний символ — цифры.
// @author       GPT Comet Assistant, review by Perplexity
// @match        https://agis.credit7.ru/*/loan*/*/create
// @match        https://agis.creditsmile.ru/*/loan*/*/create
// @match        https://agis.belkacredit.ru/*/loan*/*/create
// @match        https://agis.volgazaim.ru/*/loan*/*/create
// @match        https://agis.credit365.ru/*/loan*/*/create
// @match        https://agis.berrycash.ru/*/loan*/*/create
// @match        https://agis.moneymania.ru/*/loan*/*/create
// @run-at       document-start
// @sandbox      DOM
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = 'AGIS Paste Cleaner';

    // id$="amount" покрывает и "amount", и "_amount".
    const TARGET_SELECTOR = [
        'input[type="text"][id$="_income"]',
        'input[type="text"][id$="amount"]',
    ].join(', ');

    const boundInputs = new WeakSet();
    const cleanupTasks = new Set();

    let domObserverStop = null;

    function warn(...args) {
        console.warn(`[${SCRIPT_NAME}]`, ...args);
    }

    function addCleanup(fn) {
        cleanupTasks.add(fn);
        return () => cleanupTasks.delete(fn);
    }

    function cleanup() {
        for (const fn of Array.from(cleanupTasks)) {
            try {
                fn();
            } catch (err) {
                warn('Ошибка cleanup:', err);
            }
        }

        cleanupTasks.clear();
        domObserverStop = null;
    }

    function debounce(fn, wait = 150) {
        let timer = null;

        const debounced = function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };

        debounced.cancel = () => clearTimeout(timer);

        return debounced;
    }

    // Ждём DOM-элемент через MutationObserver, а не предполагаем, что он уже есть.
    function waitForElement(selector, { root = document, timeout = 15000 } = {}) {
        return new Promise((resolve, reject) => {
            const existing = root.querySelector?.(selector);
            if (existing) {
                resolve(existing);
                return;
            }

            const observeRoot = root === document
                ? document.documentElement || document
                : root;

            let finished = false;

            const observer = new MutationObserver(() => {
                const found = root.querySelector?.(selector);

                if (!found) {
                    return;
                }

                finished = true;
                observer.disconnect();
                clearTimeout(timer);
                unregisterCleanup();
                resolve(found);
            });

            const timer = setTimeout(() => {
                if (finished) {
                    return;
                }

                observer.disconnect();
                unregisterCleanup();
                reject(new Error(`Элемент "${selector}" не найден за ${timeout} мс`));
            }, timeout);

            const stop = () => {
                observer.disconnect();
                clearTimeout(timer);
            };

            const unregisterCleanup = addCleanup(stop);

            observer.observe(observeRoot, {
                childList: true,
                subtree: true,
            });
        });
    }

    // Обрабатываем только добавленные узлы, чтобы не делать полный querySelectorAll на каждую мутацию.
    function observeAddedElements(selector, callback, { root = document } = {}) {
        const scanNode = (node) => {
            if (!(node instanceof Element)) {
                return;
            }

            if (node.matches(selector)) {
                callback(node);
            }

            node.querySelectorAll?.(selector).forEach(callback);
        };

        root.querySelectorAll?.(selector).forEach(callback);

        const observeRoot = root === document
            ? document.documentElement || document
            : root;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(scanNode);
            }
        });

        observer.observe(observeRoot, {
            childList: true,
            subtree: true,
        });

        let unregisterCleanup = null;

        const stop = () => {
            observer.disconnect();

            if (unregisterCleanup) {
                unregisterCleanup();
                unregisterCleanup = null;
            }
        };

        unregisterCleanup = addCleanup(stop);

        return stop;
    }

    // SPA может менять route без полной перезагрузки страницы.
    function onUrlChange(callback) {
        let lastUrl = location.href;

        const check = () => {
            const currentUrl = location.href;

            if (currentUrl === lastUrl) {
                return;
            }

            lastUrl = currentUrl;
            callback(currentUrl);
        };

        const timer = setInterval(check, 800);

        window.addEventListener('popstate', check);
        window.addEventListener('hashchange', check);

        const stop = () => {
            clearInterval(timer);
            window.removeEventListener('popstate', check);
            window.removeEventListener('hashchange', check);
        };

        addCleanup(stop);

        return stop;
    }

    // Оставляем только цифры, "." и ","; затем убираем разделители по краям.
    function cleanInput(value) {
        return String(value ?? '')
            .replace(/[^0-9.,]/g, '')
            .replace(/^[^0-9]+/, '')
            .replace(/[^0-9]+$/, '');
    }

    function setNativeInputValue(input, value) {
        const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
        const prototypeDescriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        );

        const setter = ownDescriptor?.set || prototypeDescriptor?.set;

        if (setter) {
            setter.call(input, value);
        } else {
            input.value = value;
        }
    }

    function dispatchInputEvents(input, insertedText) {
        let inputEvent;

        try {
            inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: insertedText,
            });
        } catch (_) {
            inputEvent = new Event('input', {
                bubbles: true,
                cancelable: true,
            });
        }

        input.dispatchEvent(inputEvent);
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function replaceSelection(input, text) {
        const value = input.value ?? '';

        const hasSelectionApi = (
            typeof input.selectionStart === 'number'
            && typeof input.selectionEnd === 'number'
        );

        const start = hasSelectionApi ? input.selectionStart : value.length;
        const end = hasSelectionApi ? input.selectionEnd : value.length;

        const nextValue = value.slice(0, start) + text + value.slice(end);
        const nextCaretPosition = start + text.length;

        setNativeInputValue(input, nextValue);

        if (hasSelectionApi && document.activeElement === input) {
            try {
                input.setSelectionRange(nextCaretPosition, nextCaretPosition);
            } catch (_) {
                // Некоторые типы input не поддерживают setSelectionRange.
            }
        }

        dispatchInputEvents(input, text);
    }

    function getClipboardText(event) {
        const clipboard = event.clipboardData || window.clipboardData;

        if (!clipboard) {
            return null;
        }

        return clipboard.getData('text/plain') || clipboard.getData('text') || '';
    }

    function onPasteHandler(event) {
        const input = event.currentTarget;

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        if (input.disabled || input.readOnly) {
            return;
        }

        const pastedText = getClipboardText(event);

        if (pastedText === null || pastedText === '') {
            return;
        }

        const cleanedText = cleanInput(pastedText);

        // Если текст уже корректный, отдаём вставку браузеру: так лучше работают нативные события.
        if (cleanedText === pastedText) {
            return;
        }

        event.preventDefault();
        replaceSelection(input, cleanedText);
    }

    function bindInput(input) {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        if (boundInputs.has(input)) {
            return;
        }

        if (!input.matches(TARGET_SELECTOR)) {
            return;
        }

        boundInputs.add(input);

        // Capture=true позволяет очистить вставку до большинства обработчиков страницы.
        input.addEventListener('paste', onPasteHandler, true);

        addCleanup(() => {
            input.removeEventListener('paste', onPasteHandler, true);
        });
    }

    async function bootstrap() {
        try {
            // document-start не гарантирует наличие body.
            await waitForElement('body', { timeout: 15000 }).catch(() => null);

            if (domObserverStop) {
                domObserverStop();
                domObserverStop = null;
            }

            document.querySelectorAll(TARGET_SELECTOR).forEach(bindInput);
            domObserverStop = observeAddedElements(TARGET_SELECTOR, bindInput);
        } catch (err) {
            warn('Ошибка инициализации:', err);
        }
    }

    const rebootstrap = debounce(bootstrap, 150);

    window.addEventListener('pagehide', cleanup, { once: true });

    onUrlChange(() => {
        rebootstrap();
    });

    bootstrap();
})();
