# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это за репозиторий

Набор Tampermonkey-userscript'ов (чистый JavaScript, без сборки, без зависимостей,
без `package.json`) для внутренней admin-панели AGIS (`agis.<бренд>.ru`, 7 доменов-брендов:
creditsmile, belkacredit, volgazaim, berrycash, moneymania, credit7, credit365).
Каждый файл в `scripts/*.user.js` — самостоятельный production-скрипт, который
пользователь вручную устанавливает в Tampermonkey.

Нет build/lint/test команд — это не Node-проект. Проверка изменений — ручной
smoke-test в браузере (см. ниже) и чтение кода, т.к. запускать userscript можно
только внутри Tampermonkey в реальном браузере.

## Роли файлов (важно понимать перед правкой)

| Файл | Роль |
|---|---|
| `core-template.user.js` | **Канон**. Эталонный каркас: `waitForElement`, `observeAddedElements`, `storageGet`/`storageSetDebounced`, `httpRequest`/`api.getJson`/`api.postJson`/`api.getHtml`, `onUrlChange`, `routeToken`, `cleanupRoute`/`cleanup`. Все новые скрипты пишутся на основе его API. |
| `template-tamper-monkey.md` | Обучающее объяснение более старой/упрощённой версии каркаса — читать для контекста, но код брать только из `core-template.user.js`. |
| `space-prompt.md` | System-prompt для AI-ассистента (Perplexity Space), который генерирует/правит эти скрипты вне Claude Code. |
| `README.md` | Нормативный документ: требования к метаблоку, чеклист code review, правила версионирования, smoke-test. Это источник правды по стандартам. |
| `ROADMAP.md` | Разрыв между каждым production-скриптом и каноном (в процентах) + план из 5 волн по унификации. Полезно перед рефакторингом, но таблица **устаревает быстро** — например `linkify-loan-note` и `rusupport-clipboard` в ней всё ещё числятся на старых версиях (2.10/40%, 1.0.0/50%), хотя уже переписаны на канон (см. `@version` в самом файле и git log). Сверяйся с реальным `@version` файла, а не только с таблицей. |
| `scripts/*.user.js` | Production-скрипты. |

**При конфликте между `core-template.user.js` и `template-tamper-monkey.md` побеждает `core-template.user.js`.**

## Важный архитектурный факт: нет реального переиспользования кода

`core-template.user.js` **не подключается через `@require`** — Tampermonkey-скрипты
здесь не поддерживают общий импортируемый модуль (см. ROADMAP, Волна 2, ещё не сделана).
Поэтому каждый скрипт в `scripts/` **копирует и адаптирует** нужные функции каркаса
вручную, и на практике версии этих функций успели разойтись (свои `waitForElement`,
свой `debounce`, `setInterval`-поллинг вместо `MutationObserver` и т.д. — см. таблицу
соответствия в `ROADMAP.md`). Когда правишь существующий скрипт или пишешь новый:

- Бери актуальную реализацию функций из `core-template.user.js`, а не из другого
  скрипта в `scripts/` — они могут быть устаревшей копией.
- `agis-loan-info-navbar.user.js` (v4.7) — текущий эталон соответствия канону.
- Не вводи ещё одну независимую копию `waitForElement`/`onUrlChange` — это ровно та
  проблема, которую чинит ROADMAP.

## Обязательный метаблок каждого `*.user.js`

`@name`, `@namespace` (уникальный, не дефолтный), `@version` (SemVer, повышать при
любом изменении логики), `@match` (точный, никогда `*://*/*`), `@grant` (только то,
что реально используется в коде), `@connect` (по одному на хост для каждого
`GM_xmlhttpRequest`, никогда `*`), `@run-at` (обоснованный выбор — `document-start`
только если нужно перехватить что-то до парсинга HTML/рендера, иначе `document-end`),
`@sandbox` (`DOM` по умолчанию; `JavaScript`/`raw` только с явным комментарием, зачем
нужен `unsafeWindow`).

## Ключевые инварианты каркаса (см. `core-template.user.js` для реализации)

- Работа с DOM всегда через `waitForElement()` / `observeAddedElements()` —
  никогда `setInterval`-поллинг и никогда прямой `document.querySelector` в момент
  старта (на `document-start` DOM ещё может быть не готов).
- `MutationObserver` вешается на конкретный root (`document.body`/`documentElement`),
  не на `window`.
- SPA-навигация ловится через `onUrlChange()` (перехват `pushState`/`replaceState`
  + `popstate`/`hashchange`), вызывается **ровно один раз** за жизнь страницы.
  `cleanupRoute()` вызывается первым действием в каждом `bootstrap()`.
- `routeToken` инкрементируется на каждый route-переход; проверяется `token !==
  routeToken` после каждого `await` (после `waitForElement`, после парсинга,
  после `storageGet`, после сетевого запроса) — иначе можно отрендерить данные
  устаревшего маршрута после SPA-перехода.
- `pagehide` вызывает `cleanup()` (все таймеры + все observer'ы) и стоп-функцию
  `onUrlChange`.
- `GM_getValue`/`GM_setValue` — асинхронные, всегда `await` + `try/catch`
  (`storageGet`), частые записи — только через debounce (`storageSetDebounced`).
  Ключи кэша должны включать версию (`CACHE_VERSION`) на случай смены формата.
- Сетевые запросы к другим доменам/в обход CSP — только `GM_xmlhttpRequest`
  (`httpRequest`/`api.getJson`/`api.postJson`), не `fetch()`/`XHR` страницы.
- Никаких `innerHTML` с непроверенными данными (`textContent`/DOM API вместо),
  никакого `eval()`/`new Function()`.
- Логи — `console.warn`/`console.error` с префиксом `[SCRIPT_NAME]`; при таймауте
  `waitForElement` логировать, какой селектор не найден.

## Версионирование

Патч — тайпо/комментарий (без изменения `CACHE_VERSION`). Минор — изменение
логики/парсинга/рендера (`CACHE_VERSION` растёт). Мажор — изменение структуры
кэша. Полная таблица и smoke-test чеклист (Chrome/Firefox/Edge, hard reload,
SPA-переход, консоль без ошибок) — в `README.md`.
