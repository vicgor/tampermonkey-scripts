# tampermonkey-scripts

Репозиторий устойчивых Tampermonkey-скриптов с единым базовым ядром.

## Структура

```
tampermonkey-scripts/
├── core-template.user.js   # Базовый каркас — основа всех скриптов
├── space-prompt.md         # Промпт для Perplexity Space
├── README.md               # Этот файл
└── scripts/                # Готовые скрипты на основе каркаса
```

---

## core-template.user.js — базовый каркас

Устойчивое ядро для любого юзерскрипта. Учитывает известные баги и
ограничения Tampermonkey: задержки инъекции в Manifest V3, жёсткий CSP,
асинхронность GM_*-функций, динамический DOM, SPA-навигацию.

### Что внутри

| Функция | Назначение |
|---|---|
| `waitForElement(selector, opts)` | Ждёт появления элемента через MutationObserver с таймаутом |
| `observeAddedElements(selector, cb)` | Вызывает callback для каждого нового подходящего элемента |
| `onDomReady(callback)` | Безопасный аналог DOMContentLoaded, работает с document-start |
| `storage.get(key, fallback)` | GM_getValue с try/catch и fallback |
| `storage.setDebounced(key, delay)` | Дебаунс-обёртка для GM_setValue (защита от частых записей) |
| `api.getJson(url, headers)` | GET-запрос через GM_xmlhttpRequest, обходит CSP сайта |
| `api.postJson(url, body, headers)` | POST-запрос через GM_xmlhttpRequest |
| `onUrlChange(callback)` | Ловит SPA-навигацию через pushState/replaceState/popstate |
| `cleanup()` | Очищает все таймеры и MutationObserver-ы при выгрузке страницы |

### Ключевые правила при адаптации

- Замени `@match`, `@connect` и `@icon` на реальный домен.
- Основную логику пиши внутри `onDomReady()` в `bootstrap()`.
- Для SPA добавь переинициализацию логики в `onUrlChange()`.
- Если нужен доступ к переменным страницы — добавь `@grant unsafeWindow`
  и измени `@sandbox` на `JavaScript` или `raw`, объяснив зачем.
- Не используй `fetch()`/`XHR` напрямую на CSP-защищённых сайтах —
  используй `api.getJson()` / `api.postJson()`.

---

## Пример адаптации под конкретный сайт

Задача: на сайте `https://news.example.com` выделять статьи старше 7 дней
серым цветом и сохранять количество обработанных статей между визитами.

```javascript
// ==UserScript==
// @name         News Example — выделение старых статей
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Серый цвет для статей старше 7 дней на news.example.com
// @author       me
// @match        https://news.example.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=news.example.com
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(() => {
  'use strict';

  // ---- Вставить сюда весь код из core-template.user.js (до строки bootstrap) ----

  const SCRIPT_NS = 'news-old-articles';
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  let processedCount = 0;
  const saveCount = storage.setDebounced('processedCount', 800);

  const processArticle = (el) => {
    const dateStr = el.querySelector('time')?.getAttribute('datetime')
      || el.dataset.published;
    if (!dateStr) return;
    const published = new Date(dateStr);
    if (isNaN(published.getTime())) return;
    if (Date.now() - published.getTime() > SEVEN_DAYS_MS) {
      el.style.opacity = '0.45';
      el.style.filter = 'grayscale(60%)';
      el.title = `Статья старше 7 дней (${published.toLocaleDateString('ru-RU')})`;
      processedCount++;
      saveCount(processedCount);
    }
  };

  const bootstrap = async () => {
    if (state.started) return;
    state.started = true;
    log('Инициализация');
    const saved = await storage.get('processedCount', 0);
    processedCount = saved;
    log('Загружено из storage, обработано ранее:', processedCount);
    onDomReady(() => {
      state.observers.add(
        observeAddedElements('article.news-item, .article-card', processArticle)
      );
      onUrlChange((url) => log('SPA-переход:', url));
    });
  };

  const cleanup = () => {
    for (const t of state.saveTimers.values()) clearTimeout(t);
    state.saveTimers.clear();
    for (const o of state.observers) o.disconnect();
    state.observers.clear();
  };

  window.addEventListener('beforeunload', cleanup, { once: true });
  bootstrap().catch(e => console.error(`[${SCRIPT_NS}] Критическая ошибка`, e));
})();
```

### Что изменилось по сравнению с каркасом

| Изменение | Зачем |
|---|---|
| `@match https://news.example.com/*` | Ограничили сайт |
| Убраны `GM_xmlhttpRequest` и `@connect` | Запросы не нужны |
| `observeAddedElements('article.news-item, ...')` | Ловим все новые карточки |
| `processArticle()` | Основная логика выделения |
| `storage.setDebounced('processedCount', 800)` | Редко сохраняем счётчик |
| `onUrlChange()` оставлен с логом | SPA-переходы — наблюдатель продолжит работу |

---

## Известные ограничения и риски

| Риск | Описание | Митигация |
|---|---|---|
| MV3 задержка инъекции | Service worker перезапускается, скрипт может стартовать с задержкой 50–500 мс | `waitForElement` с таймаутом |
| CSP сайта | fetch()/XHR могут блокироваться на строгих CSP | `GM_xmlhttpRequest` + `@connect` |
| Chrome/Edge MV3 | Нужен Developer Mode или разрешение «Allow user scripts» | Инструкция в README и в скрипте |
| Ломкие селекторы | Сайт меняет классы при обновлении вёрстки | Использовать data-атрибуты и семантические теги где возможно |
| Firefox: Instant Injection | Несовместима со скриптами, требующими локальных файлов | Отключить Instant Injection в настройках TM |
| `unsafeWindow` | Даёт доступ к JS-переменным страницы, но открывает риски XSS | Использовать только по необходимости, `@sandbox JavaScript` |

---

## Как установить Tampermonkey и включить поддержку скриптов

1. Установите расширение: [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) /
   [Firefox](https://addons.mozilla.org/ru/firefox/addon/tampermonkey/) /
   [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
2. **Chrome/Edge (MV3):** включите Developer Mode в `chrome://extensions` или
   разрешение «Allow user scripts» в настройках расширения.
3. В Tampermonkey Dashboard нажмите «+», вставьте код скрипта, сохраните (`Ctrl+S`).
4. Откройте нужный сайт, проверьте консоль браузера по префиксу `[script-namespace]`.
