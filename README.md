# tampermonkey-scripts

Репозиторий устойчивых Tampermonkey-скриптов с единым базовым ядром.

---

## Роли файлов

| Файл | Роль | Нельзя |
|---|---|---|
| `core-template.user.js` | **Канон**. Единый источник инфраструктурного API. Все скрипты строятся на нём. | Не упрощать без обновления всех зависимых скриптов |
| `template-tamper-monkey.md` | **Обучающее пояснение**. Читать прежде написания нового скрипта. | Копировать код из него — брать из `core-template.user.js` |
| `space-prompt.md` | **Policy-слой**. Правила для AI-ассистента (Perplexity Space). | Редактировать вручную без осознанного PR |
| `README.md` | **Стандарты**. Требования, чеклист ревью, правила релиза. | Использовать как шаблон |
| `scripts/*.user.js` | **Production скрипты**. Используют API каркаса и предметную логику. | Реимплементировать инфраструктуру вручную |

> **Правило.** В случае конфликта между `core-template.user.js` и `template-tamper-monkey.md` — прав канонический `core-template.user.js`.

---

## Структура

```
tampermonkey-scripts/
├── core-template.user.js   # Базовый каркас — основа всех скриптов
├── template-tamper-monkey.md  # Обучающее пояснение к каркасу
├── space-prompt.md         # Policy-слой: правила AI-ассистента
├── README.md               # Стандарты и чеклист ревью
└── scripts/                # Production-скрипты
    ├── agis-loan-info-navbar.user.js
    └── ...
```

---

## Стандарты userscript’ов

### Метаблок: обязательный минимум

| Директива | Требование |
|---|---|
| `@name` | Описательное, не общее |
| `@namespace` | Уникальный префикс домен/функция, не `http://tampermonkey.net/` по умолчанию |
| `@version` | SemVer (`MAJOR.MINOR`). При любом изменении логики/структуры — повышать |
| `@match` | Точный URL-паттерн, не шире необходимого. Не оставлять `*://*/*` |
| `@grant` | Только то, что реально используется. `GM_xmlhttpRequest` — обязательно если есть сетевые запросы |
| `@connect` | По одному домену на каждый хост. Не `*` |
| `@run-at` | `document-start` — юзать осознанно. Это ранний момент инъекции, а **не готовность DOM**. Для простых DOM-скриптов достаточно `document-end` |
| `@sandbox` | `DOM` — по умолчанию. `JavaScript`/`raw` — только если нужен `unsafeWindow`, с пояснением |

### Когда использовать `document-start`

Используй `@run-at document-start` только если скрипт должен:
- перехватывать события или методы до парсинга HTML,
- внедрять стили прежде, чем отрендерится страница,
- настраивать `history.pushState` до старта SPA.

В остальных случаях достаточно `document-end` — он проще и предсказуемее.

### Когда использовать `GM_xmlhttpRequest`

Используй `GM_xmlhttpRequest` + `@connect <host>` если:
- сайт имеет `Content-Security-Policy`, блокирующий `fetch()` или XHR,
- нужно делать запрос на другой домен или к тому же хосту за данными, недоступными в DOM.

В остальных случаях используй `fetch()` / `XHR` напрямую.

### Когда использовать `unsafeWindow`

Используй `unsafeWindow` только если нужен доступ к JS-переменным страницы
(например, `window.reactInstance` или CSRF-токен).Измени `@sandbox` на `JavaScript` или `raw`
и обязательно добавь комментарий, зачем.

---

## Чеклист code review

Перед мержем любого PR со 0 штрафов проверяем каждый пункт.

### Метаблок

- [ ] `@name`, `@namespace`, `@version`, `@description` — заполнены, без заглушек
- [ ] `@match` — точный паттерн, не шире `*://*/*`. Хотя бы одна `@match` есть
- [ ] `@grant` — перечислены только те, что реально вызываются в коде
- [ ] `@connect` — есть для каждого `GM_xmlhttpRequest`-хоста, не `*`
- [ ] `@run-at` — выбор обоснован (см. таблицу выше)
- [ ] `@sandbox` — `DOM` по умолчанию; если `JavaScript`/`raw` — есть объяснение зачем
- [ ] Файл называется `name.user.js`

### DOM и ожидание

- [ ] Работа с DOM идёт через `waitForElement()`, а не прямым доступом `document.querySelector` в старт
- [ ] Нет `setInterval`/`setTimeout`-поллинга вместо `MutationObserver`
- [ ] `MutationObserver` навешен на конкретный root (например, `document.body`), не на `window`
- [ ] Нет локальных копий `waitForElement` / `observeTableChanges` — используется API из `core-template.user.js`

### SPA и lifecycle

- [ ] Есть `onUrlChange()` с переинициализацией логики при смене маршрута
- [ ] `cleanupRoute()` вызывается перед каждой переинициализацией
- [ ] `pagehide` / `beforeunload` выполняет cleanup всех таймеров и observerов
- [ ] `routeToken` проверяется после каждого `await`

### Storage

- [ ] `GM_getValue` и `GM_setValue` используются через `storageGet` / `storageSetDebounced` (с `try/catch`)
- [ ] Частые записи идут через debounce
- [ ] Кэш имеет `CACHE_VERSION` в ключе

### Безопасность рендера

- [ ] Нет `innerHTML` с непроверенными данными — используется `textContent` или DOM API
- [ ] Нет `eval()`, `new Function()`, инлайновых `<script>` на CSP-страницах
- [ ] `GM_xmlhttpRequest` обрабатывает `onerror` и проверяет `status !== 200`

### Логирование

- [ ] Все `console.warn` / `console.error` используют префикс `[SCRIPT_NAME]`
- [ ] При timeout `waitForElement` логируется, какой селектор не найден

---

## Правила релиза

### Версионирование

| Изменение | `@version` | `CACHE_VERSION` |
|---|---|---|
| Исправление тайпа, комментарий | patch | не меняется |
| Изменение логики / парсинга / рендера | minor | повышается |
| Изменение структуры кэша | major | повышается |
| Добавление или удаление фичи | minor или major | по ситуации |

### Smoke-test перед релизом

- [ ] Chrome/Edge: обычный режим
- [ ] Firefox: обычный режим
- [ ] Hard reload — скрипт запускается с чистого кэша
- [ ] SPA-переход между двумя займами — панель обновляется
- [ ] Быстрая смена URL (несколько переходов за < 1 с) — нет вспышки данных старого маршрута
- [ ] В консоли нет неожиданных ошибок

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
| `storageGet(key, fallback)` | GM_getValue с try/catch и fallback |
| `storageSetDebounced(key, wait?)` | Фабрика: возвращает `(value) => void` с debounce-записью в GM_setValue |
| `httpRequest(opts)` | Промис поверх GM_xmlhttpRequest |
| `api.getJson(url, headers)` | GET-запрос, обходит CSP сайта |
| `api.postJson(url, body, headers)` | POST-запрос, обходит CSP сайта |
| `onUrlChange(callback)` | Ловит SPA-навигацию через pushState/replaceState/popstate/hashchange |
| `cleanupRoute()` | Очищает все таймеры и MutationObserver-ы при смене маршрута |

### Ключевые правила при адаптации

- Замени `@match`, `@connect` и `@icon` на реальный домен.
- Основную логику пиши внутри `bootstrap()`.
- Для SPA добавь переинициализацию логики в `onUrlChange()`.
- Если нужен `unsafeWindow` — добавь `@grant unsafeWindow` и изменить `@sandbox`, объяснив зачем.
- Не использовать `fetch()`/`XHR` на CSP-защищённых сайтах — использовать `api.getJson()` / `api.postJson()`.

---

## Пример адаптации под конкретный сайт

Задача: на сайте `https://news.example.com` выделять статьи старше 7 дней
серым цветом и сохранять количество обработанных статей между визитами.

```javascript
// ==UserScript==
// @name         News Example — выделение старых статей
// @namespace    news-example.old-articles
// @version      0.1
// @description  Серый цвет для статей старше 7 дней на news.example.com
// @match        https://news.example.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=news.example.com
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(() => {
  'use strict';

  // Вставить сюда весь код из core-template.user.js

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  let processedCount = 0;
  const saveCount = storageSetDebounced('processedCount', 800);

  const processArticle = (el) => {
    const dateStr = el.querySelector('time')?.getAttribute('datetime');
    if (!dateStr) return;
    const published = new Date(dateStr);
    if (isNaN(published.getTime())) return;
    if (Date.now() - published.getTime() > SEVEN_DAYS_MS) {
      el.style.opacity = '0.45';
      processedCount++;
      saveCount(processedCount);
    }
  };

  async function bootstrap() {
    processedCount = await storageGet('processedCount', 0);
    onDomReady(() => {
      observeAddedElements('article.news-item', processArticle);
      onUrlChange(() => {/* SPA: observer продолжает работать */});
    });
  }

  bootstrap();
})();
```

### Что изменилось по сравнению с каркасом

| Изменение | Зачем |
|---|---|
| `@match https://news.example.com/*` | Ограничили сайт |
| Убраны `GM_xmlhttpRequest` и `@connect` | Запросы не нужны |
| `observeAddedElements('article.news-item', ...)` | Ловим все новые карточки |
| `const saveCount = storageSetDebounced('processedCount', 800)` | Фабрика debounced-записи счётчика |

---

## Известные ограничения и риски

| Риск | Описание | Митигация |
|---|---|---|
| MV3 задержка инъекции | Service worker перезапускается, скрипт стартует с задержкой 50–500 мс | `waitForElement` с таймаутом |
| `document-start` ≠ готовность DOM | Ранний момент инъекции ≠ есть нужные элементы | Вся работа с DOM через `waitForElement` |
| CSP сайта | `fetch()`/`XHR` могут блокироваться на строгих CSP | `GM_xmlhttpRequest` + `@connect` |
| Chrome/Edge MV3 | Нужен Developer Mode или разрешение «Аллов user scripts» | Инструкция ниже |
| Ломкие селекторы | Сайт меняет классы при обновлении вёрстки | Использовать `data-`-атрибуты и семантические теги где возможно |
| Firefox: Instant Injection | Несовместима со скриптами, требующими локальных файлов | Отключить Instant Injection в настройках TM |
| `unsafeWindow` | Даёт доступ к JS-переменным страницы, но открывает риски XSS | Только по необходимости, `@sandbox JavaScript` |

---

## Как установить Tampermonkey и включить поддержку скриптов

1. Установите расширение: [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) /
   [Firefox](https://addons.mozilla.org/ru/firefox/addon/tampermonkey/) /
   [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
2. **Chrome/Edge (MV3):** включите Developer Mode в `chrome://extensions` или
   разрешение «Аллов user scripts» в настройках расширения.
3. В Tampermonkey Dashboard нажмите «+», вставьте код скрипта, сохраните (`Ctrl+S`).
4. Откройте нужный сайт, проверьте консоль браузера по префиксу `[SCRIPT_NAME]`.
