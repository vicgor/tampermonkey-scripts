# tampermonkey-scripts

[![CI](https://github.com/vicgor/tampermonkey-scripts/actions/workflows/ci.yml/badge.svg)](https://github.com/vicgor/tampermonkey-scripts/actions/workflows/ci.yml)

Репозиторий устойчивых Tampermonkey-скриптов с единым базовым ядром.

---

## Роли файлов

| Файл | Роль | Нельзя |
|---|---|---|
| `lib/agis-core.js` | **Канон**. Единственный источник инфраструктурного API. Подключается всеми скриптами через `@require` с версионированным тегом + SRI-хешем. | Менять содержимое существующего тега задним числом — только новый тег + новый хеш |
| `templates/example-consumer.user.js` | **Живой пример** потребителя `lib/agis-core.js`. Читать/копировать структуру прежде написания нового скрипта. | Копировать код каркаса вручную вместо `@require` |
| `template-tamper-monkey.md` | **Историческое обучающее пояснение** (до появления `lib/agis-core.js`). | Брать из него код для нового скрипта — устарел |
| `space-prompt.md` | **Policy-слой**. Правила для AI-ассистента (Perplexity Space). | Редактировать вручную без осознанного PR |
| `README.md` | **Стандарты**. Требования, чеклист ревью, правила релиза. | Использовать как шаблон |
| `scripts/*.user.js` | **Production скрипты**. `@require`'ят `lib/agis-core.js`, содержат только предметную логику. | Реимплементировать инфраструктуру вручную |

---

## Структура

```
tampermonkey-scripts/
├── lib/
│   └── agis-core.js        # Общее ядро — @require с SRI-хешем во всех скриптах
├── templates/
│   └── example-consumer.user.js  # Живой пример потребителя ядра
├── template-tamper-monkey.md  # Историческое обучающее пояснение
├── space-prompt.md         # Policy-слой: правила AI-ассистента
├── README.md               # Стандарты и чеклист ревью
└── scripts/                # Production-скрипты
    ├── agis-loan-info-navbar.user.js
    └── ...
```

---

## Инструменты разработки (ESLint + Prettier)

`package.json` есть только ради качества кода — сами userscript'ы не собираются
и не бандлятся, ставятся в Tampermonkey как есть.

```bash
npm install
npm run lint           # ESLint: метаблок, инварианты каркаса, безопасность рендера
npm run format         # Prettier --write (2 пробела, одинарные кавычки)
npm run format:check   # Prettier --check, без изменений — для проверки перед коммитом
npm run validate-meta  # scripts/validate-meta.js — @grant/@connect/@namespace/@match (см. ниже)
npm run check-version-bump  # scripts/check-version-bump.js — @version бампнут, если файл менялся (только в PR-контексте CI)
```

Конфиг ESLint (`eslint.config.js`) проверяет:
- корректность метаблока (`@name`/`@version`/`@grant`/... через `eslint-plugin-userscripts`);
- запрет `fetch()`/`XMLHttpRequest` (напоминание про `GM_xmlhttpRequest`/`api.*` из `lib/agis-core.js`);
- запрет `setInterval` вместо `MutationObserver` (кроме обоснованных fallback-случаев — глуши точечно через `eslint-disable-next-line` с комментарием, зачем);
- запрет `innerHTML` (используй `textContent`/DOM API).

`eslint-plugin-userscripts` проверяет только *присутствие* полей метаблока и
валидность значений `@grant` по списку известных GM-функций — не то,
*соответствуют* ли они реальному использованию в коде. Это добавляет
`scripts/validate-meta.js` (Волна 4.5, `npm run validate-meta`):
- **`@grant` vs код**: для каждой обёртки `lib/agis-core.js` (`storageGet` →
  `GM_getValue`, `httpRequest`/`api.*` → `GM_xmlhttpRequest` и т.д. — полная
  карта в шапке `WRAPPER_GRANTS` файла) и для прямых вызовов `GM_*` — если
  использование есть, а `@grant` не объявлен, это `ERROR`; если `@grant`
  объявлен, а использование не найдено — `WARNING` (могло не попасть в карту
  обёрток, поэтому не блокирует CI, но стоит перепроверить вручную);
- **`@connect`**: обязателен и не может быть `*`, если скрипт использует
  `GM_xmlhttpRequest` (напрямую или через `httpRequest`/`api.*`);
- **`@namespace`**: уникален среди всех `scripts/*.user.js` и не равен дефолту
  Tampermonkey (`http://tampermonkey.net/`);
- **`@match`**: не открыт на любой хост (`*://*/*` и т.п.).

Бамп `@version` при изменении файла проверяет отдельный скрипт —
`scripts/check-version-bump.js` (`npm run check-version-bump`): если
`scripts/*.user.js` изменился между базовой веткой PR и HEAD, а строка
`@version` в нём — нет, это `ERROR` (см. "Версионирование" ниже — даже
патч-правка типа/комментария требует бампа). Работает только в PR-контексте
GitHub Actions (нужен `GITHUB_BASE_REF` и полная git-история — `ci.yml`
использует `fetch-depth: 0`); при прямом push в `main` или локальном запуске
молча пропускает проверку, не блокируя `npm run lint`.

Что осознанно не проверяется (см. ROADMAP.md): обоснованность `@sandbox`/`@run-at`
— слишком эвристично для надёжного статического анализа.

Prettier — 2 пробела, одинарные кавычки, точка с запятой, ширина строки 120.
Не форматирует `*.md` (таблицы и кириллица в них форматируются Prettier не всегда
аккуратно) — только `.js`/`.user.js`.

**CI** (`.github/workflows/ci.yml`) гоняет `npm run lint`, `npm run format:check`,
`npm test`, `npm run validate-meta` и `npm run check-version-bump` на каждый PR
и на push в `main` — то же самое, что локально (кроме бампа `@version`, который
имеет смысл только в PR-контексте), без отдельного конфига. Если CI зелёный,
дополнительно гонять линтер/тесты перед мержем не нужно.

---

## Тесты

`npm test` (vitest) покрывает чистые парсеры/форматтеры и DOM-зависимые парсеры
(через `jsdom`). Тесты лежат в `test/`, зеркалируя `lib/`/`scripts/`
(`test/scripts/<script>.test.js`).

Скрипты — это IIFE, ничего не экспортирующие по умолчанию (нужно для Tampermonkey).
Чтобы функции были доступны тестам без сборки, в начале (или в конце/после нужных
констант, если экспортируемая функция от них зависит — иначе TDZ при раннем
`return`) IIFE стоит guard:

```js
if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
  module.exports = { someUtilityFunction };
  return;
}
```

В Tampermonkey ни `process`, ни `module` не определены — блок мёртвый код,
поведение не меняется (`process.versions?.node` — доп. проверка по итогам
ревью PR #29, чтобы не полагаться только на отсутствие `module`).

**Функции, зависящие от констант ниже по файлу.** Если экспортируемая функция
читает по замыканию `const`/`let`, объявленные ниже (например, `statusColor` в
`agis-loan-info-navbar.user.js` — множества `STATUS_*`), их нужно объявить ДО
guard'а — иначе при раннем `return` они остаются в TDZ навсегда, и вызов функции
из теста упадёт. Сами `function`-объявления переносить не нужно — они поднимаются
целиком независимо от места в файле, в отличие от `const`/`let`.

**Функции, зависящие от `ruMonthNumber` ядра.** В браузере `ruMonthNumber`
приходит из `window.__AGIS_CORE__` (доступно только после `@require` реального
`lib/agis-core.js`). В тестовом guard'е вместо дублирования её логики или
подделки `window.__AGIS_CORE__` используем `require('../lib/agis-core.js').ruMonthNumber`
(живой только в этой Node-ветке — в Tampermonkey `require` не определён, ветка
мёртвая) — см. `agis-loan-info-navbar.user.js` (`ruMonthNumber` объявлена как
`let` до guard'а, присваивается либо из `require`, либо из `window.__AGIS_CORE__`
после реальной загрузки ядра).

**DOM-зависимые парсеры (`parseDoc`, `getRowValue`, `getRowCell` и т.п.).**
Тестируются через `jsdom`: тестовый файл помечается пагмой
`// @vitest-environment jsdom` первой строкой (переопределяет глобальный
`environment: 'node'` из `vitest.config.js` только для этого файла), фикстура —
реальный (анонимизированный) HTML-кусок страницы AGIS из `fixtures/`, парсится
через `new DOMParser().parseFromString(html, 'text/html')` (глобальный в jsdom).
Фикстуры собираются из реального браузера, а не реверс-инжинирятся из регексов
парсера — иначе тест проверяет только совпадение с самим собой, а не с реальной
страницей. См. `fixtures/agis-loan-edit.html` и
`test/scripts/agis-loan-info-navbar.dom.test.js`.

Добавляя новую чистую функцию в существующий файл — добавь её имя в
существующий `module.exports` того же guard'а, не создавай второй guard.
В новом файле — скопируй guard по образцу соседнего скрипта.

---

## Стандарты userscript’ов

### Домены AGIS — источник истины

Все скрипты покрывают все 11 брендов/доменов AGIS, если нет явной причины для
сужения (причина указывается в комментарии над `@match`). Это канонический
список — 11 доменов, ни больше, ни меньше:

| Бренд | Домен |
|---|---|
| CreditSmile | `agis.creditsmile.ru` |
| BelkaCredit | `agis.belkacredit.ru` |
| VolgaZaim | `agis.volgazaim.ru` |
| BerryCash | `agis.berrycash.ru` |
| MoneyMania | `agis.moneymania.ru` |
| Credit7 | `agis.credit7.ru` |
| Credit365 | `agis.credit365.ru` |
| VashCash | `agis.vashcash.ru` |
| IkraCredit | `agis.ikracredit.ru` |
| Zaimix | `agis.zaimix.ru` |
| FinRook | `agis.finrook.ru` |

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

Перед мержем любого PR со 0 штрафов проверяем каждый пункт. Часть пунктов
(метаблок, `fetch`/`XMLHttpRequest`, `setInterval`, `innerHTML`) уже проверяет
`npm run lint` — но это дополнение к ручному ревью, не замена: линтер не видит
архитектурные вещи вроде `routeToken`/`cleanupRoute`/debounce хранилища.

### Метаблок

- [ ] `@name`, `@namespace`, `@version`, `@description` — заполнены, без заглушек
- [ ] `@match` — точный паттерн, не шире `*://*/*`. Хотя бы одна `@match` есть
- [ ] `@match` покрывает все 11 доменов AGIS (см. таблицу выше), если нет причины для сужения — причина в комментарии над `@match`
- [ ] `@grant` — перечислены только те, что реально вызываются в коде
- [ ] `@connect` — есть для каждого `GM_xmlhttpRequest`-хоста, не `*`
- [ ] `@run-at` — выбор обоснован (см. таблицу выше)
- [ ] `@sandbox` — `DOM` по умолчанию; если `JavaScript`/`raw` — есть объяснение зачем
- [ ] Файл называется `name.user.js`

### DOM и ожидание

- [ ] Работа с DOM идёт через `waitForElement()`, а не прямым доступом `document.querySelector` в старт
- [ ] Нет `setInterval`/`setTimeout`-поллинга вместо `MutationObserver`
- [ ] `MutationObserver` навешен на конкретный root (например, `document.body`), не на `window`
- [ ] Нет локальных копий `waitForElement` / `onUrlChange` / `storageGet` и т.д. — используется `window.__AGIS_CORE__` из `lib/agis-core.js` (`@require` + SRI-хеш)

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

## lib/agis-core.js — общее ядро

Устойчивое ядро для любого userscript'а, подключаемое через `@require` с
версионированным git-тегом + SRI-хешем (`#sha256=...`), не копированием кода.
Учитывает известные баги и ограничения Tampermonkey: задержки инъекции в
Manifest V3, жёсткий CSP, асинхронность GM_*-функций, динамический DOM,
SPA-навигацию.

```javascript
// @require https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.2.0/lib/agis-core.js#sha256=...
```

```javascript
if (!window.__AGIS_CORE__) {
  console.error('[my-script] agis-core.js не загружен (@require не сработал)');
  return;
}
const { waitForElement, onUrlChange, api, showBanner } = window.__AGIS_CORE__;
```

### Что внутри

| Функция | Назначение | Требует `@grant` |
|---|---|---|
| `waitForElement(selector, opts)` | Ждёт появления элемента через MutationObserver с таймаутом | — |
| `observeAddedElements(selector, cb, opts)` | Вызывает callback для каждого нового подходящего элемента | — |
| `debounce(fn, wait)` | Стандартный debounce с `.cancel()` | — |
| `cleanupRoute()` | Очищает observer'ы/таймеры `waitForElement` текущего маршрута | — |
| `cleanup()` | `cleanupRoute()` + чистит storage- и UI-таймеры (для `pagehide`) | — |
| `onUrlChange(callback)` | Ловит SPA-навигацию (`pushState`/`replaceState`/`popstate`/`hashchange`), возвращает `stopFn`. Вызывать один раз за жизнь страницы | — |
| `createRouteTokenController()` | `{ next(), isCurrent(token) }` вместо ручного `let routeToken = 0` | — |
| `showBanner(text, { type, durationMs })` | Баннер в углу экрана, `type`: `success`/`error`/`info` | — |
| `storageGet(key, fallback)` | `GM_getValue` с try/catch и fallback | `GM_getValue` |
| `storageSet(key, value)` | Немедленная (не debounced) запись — когда нужно записать перед навигацией | `GM_setValue` |
| `storageSetDebounced(key, value, wait?)` | Debounced-запись в `GM_setValue` (прямой вызов, не фабрика) | `GM_setValue` |
| `storageDelete(key)` | `GM_deleteValue` с try/catch | `GM_deleteValue` |
| `httpRequest(opts)` | Промис поверх `GM_xmlhttpRequest` | `GM_xmlhttpRequest` |
| `api.getJson(url, headers)` / `api.postJson(url, body, headers)` / `api.getHtml(url, headers)` | Запросы через `httpRequest`, обходят CSP сайта | `GM_xmlhttpRequest` |
| `registerDebugToggle(scriptNs, debugKey)` | Регистрирует пункт меню Tampermonkey для debug-логов, возвращает `{ value }` (async, резолвится после чтения хранилища) | `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand` |
| `ruMonthNumber(rawMonthText)` | Парсит русское название месяца → `'01'..'12'` | — |
| `normalizeText(value)` | Схлопывает пробелы (включая nbsp) и обрезает края | — |
| `cellText(td)` | `normalizeText(td.textContent)`, `''` для `null`/`undefined` | — |

### Ключевые правила при адаптации

- Смотри `templates/example-consumer.user.js` — живой пример со всей структурой ниже.
- Замени `@match`, `@connect` и `@icon` на реальный домен; `@require` — на актуальный тег ядра (`git tag -l`).
- Основную логику пиши внутри `bootstrap()`, с `createRouteTokenController()` и проверкой `isCurrent(token)` после каждого `await`.
- `registerDebugToggle()` — асинхронный; дожидайся его перед первым `bootstrap()` (не fire-and-forget), иначе ранние `log()`-вызовы могут не напечататься даже при включённом debug.
- `onUrlChange()` устанавливай синхронно, до всех `await` — SPA-watcher не должен ждать миграцию storage или регистрацию debug-toggle.
- Если нужен `unsafeWindow` — добавь `@grant unsafeWindow` и измени `@sandbox`, объяснив зачем.
- Не использовать `fetch()`/`XHR` на CSP-защищённых сайтах — использовать `api.getJson()` / `api.postJson()` / `api.getHtml()`.

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
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.2.0/lib/agis-core.js#sha256=...
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[news-old-articles] agis-core.js не загружен (@require не сработал)');
    return;
  }
  const { storageGet, storageSetDebounced, observeAddedElements, onUrlChange } = window.__AGIS_CORE__;

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  let processedCount = 0;

  const processArticle = (el) => {
    const dateStr = el.querySelector('time')?.getAttribute('datetime');
    if (!dateStr) return;
    const published = new Date(dateStr);
    if (isNaN(published.getTime())) return;
    if (Date.now() - published.getTime() > SEVEN_DAYS_MS) {
      el.style.opacity = '0.45';
      processedCount++;
      storageSetDebounced('processedCount', processedCount, 800);
    }
  };

  async function bootstrap() {
    processedCount = await storageGet('processedCount', 0);
    observeAddedElements('article.news-item', processArticle);
  }

  onUrlChange(() => {/* SPA: observer продолжает работать, доп. переинициализация не нужна */});
  bootstrap();
})();
```

### Что изменилось по сравнению с шаблоном

| Изменение | Зачем |
|---|---|
| `@match https://news.example.com/*` | Ограничили сайт |
| Убраны `GM_xmlhttpRequest` и `@connect` | Запросы не нужны |
| `observeAddedElements('article.news-item', ...)` | Ловим все новые карточки |
| `storageSetDebounced('processedCount', processedCount, 800)` | Прямой вызов (ядро v1.1.0+, не фабрика) — debounced-запись счётчика |
| Нет `createRouteTokenController()` | Здесь одна страница без нескольких `await` подряд — токен не нужен. Для SPA с несколькими последовательными `await` в `bootstrap()` (типичный случай AGIS-скриптов) — используй его, см. `templates/example-consumer.user.js` |

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
3. Откройте install-ссылку нужного скрипта из таблицы ниже — Tampermonkey сам
   распознает `.user.js` URL и покажет диалог установки (либо вставьте код
   скрипта вручную в Tampermonkey Dashboard → «+» → `Ctrl+S`).
4. Откройте нужный сайт, проверьте консоль браузера по префиксу `[SCRIPT_NAME]`.

---

## Установка скриптов

Все скрипты покрывают все 11 брендов AGIS (см. таблицу доменов выше) — один
install на скрипт достаточен независимо от бренда. Ссылки ведут на `main` —
Tampermonkey сам предложит обновление при следующем изменении файла.

| Скрипт | Что делает | Установить |
|---|---|---|
| `agis-loan-info-navbar` | Полоса под навбаром с информацией о займе и цветным статусом | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-info-navbar.user.js) |
| `agis-duplicate-income` | Клик по строке прихода → форма создания с автозаполнением (дата, шлюз, ID, сумма) | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-duplicate-income.user.js) |
| `agis-add-income-from-googlesheet` | Автозаполнение формы прихода из Google Таблицы (CSV Publish) | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-add-income-from-googlesheet.user.js) |
| `agis-protocol-income-fill` | Перенос данных прихода из протокола поддержки в форму создания | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js) |
| `agis-paste-cleaner-amount` | Очистка вставки в полях суммы (только цифры/точки/запятые) | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-paste-cleaner-amount.user.js) |
| `agis-linkify-loan-note` | Кликабельные ссылки (markdown/голые URL/Jira RUSUPPORT-*) в колонке "Контент" | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-linkify-loan-note.user.js) |
| `agis-rusupport-clipboard` | Вставка текста из буфера в поле "Содержание" заметки, если есть RUSUPPORT | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-rusupport-clipboard.user.js) |
| `agis-fix-date-format` | Исправляет ввод даты в полях date/datetime-local (ДД.ММ.ГГГГ ↔ ГГГГ-ММ-ДД) при вводе с клавиатуры/вставке | [Install](https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-fix-date-format.user.js) |
