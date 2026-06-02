Этот шаблон — готовый каркас для Tampermonkey-скрипта, который безопасно ждёт появления нужных DOM-элементов через `MutationObserver`, использует точный `@match` вместо широких вайлдкардов и дебаунсит запись в хранилище через `GM_setValue`, чтобы избежать утечки памяти при частых сохранениях. Он стартует на `document-start` для совместимости с CSP-сайтами и работает в изолированном scope, чтобы не конфликтовать со скриптами самой страницы.[[github](https://github.com/tampermonkey/tampermonkey/issues)]

**Что учтено в шаблоне:**

- `@run-at document-start` — инъекция до применения CSP и до полной загрузки DOM.[[github](https://github.com/Tampermonkey/tampermonkey/issues/593)]
- Точный `@match` с указанием домена и пути вместо `@include *`.[[github](https://github.com/SthephanShinkufag/Dollchan-Extension-Tools/issues/641)]
- `waitForElement()` на базе `MutationObserver` — устойчивость к динамической подгрузке контента в SPA.[[reddit](https://www.reddit.com/r/firefox/comments/7vd116/firefox_tampermonkey_script_problems/)]
- `debounce()` поверх `GM_setValue` — снижение частоты записи в хранилище.[[github](https://github.com/tampermonkey/tampermonkey/issues)]
- IIFE + `'use strict'` — изоляция от глобального scope страницы.[[github](https://github.com/Tampermonkey/tampermonkey/issues/887)]

```
javascript// ==UserScript==
// @name         Robust Template
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Шаблон с ожиданием DOM, безопасным @match и дебаунсом GM_setValue
// @author       me
// @match        https://example.com/path/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // --- Утилита: дебаунс. Откладывает вызов fn, пока не пройдёт wait мс без новых вызовов.
    // Защищает от утечки памяти и частых записей в хранилище.
    function debounce(fn, wait = 500) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // --- Дебаунснутая обёртка над GM_setValue.
    // Реальная запись произойдёт только через 500 мс после последнего изменения.
    const saveState = debounce((key, value) => {
        GM_setValue(key, value);
    }, 500);

    // --- Ожидание появления элемента в DOM через MutationObserver.
    // Устойчиво к SPA-сайтам, где контент подгружается асинхронно после загрузки страницы.
    function waitForElement(selector, { timeout = 10000, root = document } = {}) {
        return new Promise((resolve, reject) => {
            // Возможно, элемент уже есть в DOM
            const existing = root.querySelector(selector);
            if (existing) return resolve(existing);

            const observer = new MutationObserver(() => {
                const el = root.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(el);
                }
            });

            observer.observe(root.documentElement || root, {
                childList: true,
                subtree: true,
            });

            // Защита от бесконечного ожидания
            const timer = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Элемент "${selector}" не найден за ${timeout} мс`));
            }, timeout);
        });
    }

    // --- Основная логика скрипта.
    async function main() {
        try {
            // Ждём появления целевого элемента вместо одноразового поиска
            const target = await waitForElement('h1');

            // Восстанавливаем сохранённое состояние (с дефолтом)
            const counter = GM_getValue('clickCount', 0);
            console.log('[Robust Template] Загружено состояние:', counter);

            // Пример: реагируем на действия пользователя и дебаунсим запись
            let clicks = counter;
            target.addEventListener('click', () => {
                clicks += 1;
                saveState('clickCount', clicks); // запись отложена и дебаунснута
                console.log('[Robust Template] Клик зафиксирован:', clicks);
            });
        } catch (err) {
            console.warn('[Robust Template]', err.message);
        }
    }

    // На document-start DOM ещё не готов — дожидаемся загрузки.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
```

**Как асинхронность работает в шаблоне:**

- `waitForElement()` возвращает Promise: либо сразу резолвится найденным элементом, либо подписывается через `MutationObserver` на изменения DOM и резолвится при появлении элемента.[[reddit](https://www.reddit.com/r/firefox/comments/7vd116/firefox_tampermonkey_script_problems/)]
- `setTimeout`-таймаут не даёт observer'у висеть вечно — если элемент так и не появился, Promise отклоняется и observer отключается.[[reddit](https://www.reddit.com/r/firefox/comments/7vd116/firefox_tampermonkey_script_problems/)]
- `saveState()` через `debounce()` сбрасывает предыдущий таймер при каждом вызове, поэтому `GM_setValue` срабатывает один раз после паузы, а не на каждое событие.[[github](https://github.com/tampermonkey/tampermonkey/issues)]

## Как установить и протестировать

1. Откройте Tampermonkey → «Создать новый скрипт» и вставьте код целиком, заменив `example.com/path/*` на нужный домен и путь.[[tampermonkey](https://www.tampermonkey.net/index.php?locale=ru)]
2. Замените селектор `'h1'` на реальный селектор целевого элемента вашего сайта.
3. Сохраните (Ctrl+S) и перейдите на страницу, подпадающую под `@match`.
4. Откройте DevTools (F12) → Console и проверьте логи `[Robust Template]`, кликая по элементу.
5. Перезагрузите страницу и убедитесь, что счётчик восстанавливается из `GM_getValue` — это подтверждает работу дебаунснутого сохранения.

## Возможные доработки

- Заменить `console.log` на условный дебаг-флаг через `GM_getValue('debug', false)`.
- Добавить `@grant GM_registerMenuCommand` для пунктов меню (учитывая известную задержку их срабатывания).[[github](https://github.com/tampermonkey/tampermonkey/issues)]
- Для строгих CSP-сайтов добавить режим инъекции «Instant» в настройках и избегать любых inline-скриптов.[[github](https://github.com/Tampermonkey/tampermonkey/issues/593)]
- Обернуть `waitForElement` в retry-логику для SPA, где элемент пересоздаётся при навигации без перезагрузки.
- Вынести селекторы в конфиг-объект, чтобы быстрее чинить «ломкие» селекторы после редизайна сайта.[[reddit](https://www.reddit.com/r/firefox/comments/7vd116/firefox_tampermonkey_script_problems/)]