# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это за репозиторий

Набор Tampermonkey-userscript'ов (чистый JavaScript, без сборки и бандлинга)
для внутренней admin-панели AGIS (`agis.<бренд>.ru`, 11 доменов-брендов:
creditsmile, belkacredit, volgazaim, berrycash, moneymania, credit7, credit365,
vashcash, ikracredit, zaimix, finrook).
Каждый файл в `scripts/*.user.js` — самостоятельный production-скрипт, который
пользователь вручную устанавливает в Tampermonkey.

Есть `package.json` для ESLint + Prettier + vitest (`npm install`, затем
`npm run lint`/`format`/`test`) — не для сборки: скрипты по-прежнему ставятся
в Tampermonkey как есть, без бандлинга. `.github/workflows/ci.yml` на каждый
PR и push в `main` гоняет `npm run lint`, `npm run format:check`, `npm test`,
`npm run validate-meta` (метаблок: `@grant`/`@connect`/`@namespace`/`@match`)
и `npm run check-version-bump` (в PR-контексте) — если CI зелёный, повторно
гонять вручную перед мержем не нужно. `npm test` (vitest) покрывает только
чистые парсеры/форматтеры и DOM-парсеры через `jsdom` — само поведение
userscript'а в браузере (SPA-навигация, DOM-инъекция, GM_*-хранилище)
по-прежнему проверяется только ручным smoke-test'ом (см. ниже) и чтением кода.

## Роли файлов (важно понимать перед правкой)

| Файл | Роль |
|---|---|
| `lib/agis-core.js` | **Канон**. Единственный источник инфраструктурного API: `waitForElement`, `observeAddedElements`, `debounce`, `cleanupRoute`/`cleanup`, `storageGet`/`storageSet`/`storageSetDebounced`/`storageDelete`, `httpRequest`/`api.getJson`/`api.postJson`/`api.getHtml`, `onUrlChange`, `createRouteTokenController`, `showBanner`, `registerDebugToggle`, `ruMonthNumber`, `normalizeText`, `cellText`. Подключается всеми `scripts/*.user.js` через `@require` с версионированным git-тегом + SRI-хешем (`#sha256=...`), не копируется вручную. |
| `templates/example-consumer.user.js` | Живой пример потребителя `lib/agis-core.js` — минимальный скрипт, показывающий структуру `bootstrap()`, `routeTokenController`, кэш+бэкенд-фолбэк, debug-toggle. Копировать структуру, а не переносить код каркаса вручную. |
| `template-tamper-monkey.md` | Обучающее объяснение более старой/упрощённой версии каркаса (до появления `lib/agis-core.js`) — читать только для исторического контекста, код брать из `templates/example-consumer.user.js`. |
| `space-prompt.md` | System-prompt для AI-ассистента (Perplexity Space), который генерирует/правит эти скрипты вне Claude Code. |
| `README.md` | Нормативный документ: требования к метаблоку, чеклист code review, правила версионирования, smoke-test, описание API `lib/agis-core.js`. Это источник правды по стандартам. |
| `ROADMAP.md` | План унификации из волн; Волны 1–4 полностью завершены (общее ядро реально `@require`'ится всеми 8 скриптами, UX/конфиг унифицированы, ESLint/Prettier/CI/инсталлятор/метаблок-валидатор/проверка бампа `@version` на PR — всё готово; `release.yml` отложен осознанно, не «не начат», см. `ROADMAP.md`). Волна 5 частично: unit-тесты + jsdom-тир завершены (`agis-loan-info-navbar.user.js` и `agis-protocol-income-fill.user.js`, фикстуры в `fixtures/`), TypeScript (`.user.ts` + esbuild) не начат — единственная существенная незакрытая задача. Таблица версий скриптов **может устаревать быстрее, чем этот файл** — сверяйся с реальным `@version` в самом скрипте и `git tag -l` для тегов ядра. |
| `scripts/*.user.js` | Production-скрипты (сейчас 8 файлов), все переведены на `lib/agis-core.js`. |

## Как реально устроено переиспользование кода

`lib/agis-core.js` подключается через `@require` с точной версией тега +
SRI-хешем, например:
```
// @require https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.2.0/lib/agis-core.js#sha256=...
```
Каждый `@require`'ящий скрипт получает свой собственный экземпляр состояния ядра
(observers/timers) — IIFE ядра выполняется отдельно в сендбоксе каждого скрипта.
Исключение — `onUrlChange`: `history.pushState`/`replaceState` общий на всю
страницу, поэтому патч ставится один раз через хаб-объект на `history`, а не
дублируется при каждом `@require`.

Когда правишь существующий скрипт или пишешь новый:

- Бери функции из `window.__AGIS_CORE__` (после `@require`), а не копируй код
  каркаса вручную и не бери реализацию из другого скрипта в `scripts/` — они
  могут отличаться версией тега.
- Актуальный тег ядра — смотри `git tag -l` (сортировка по SemVer) или
  `@require`-строку в любом недавно мигрированном скрипте.
- Новая версия ядра публикуется новым git-тегом + новым SRI-хешем; существующие
  теги (`v1.0.0`, `v1.1.0`, ...) не меняются задним числом — иначе SRI-проверка
  у уже установленных скриптов молча упадёт.
- Не вводи независимую копию `waitForElement`/`onUrlChange`/`storageGet` и т.д. —
  это ровно та проблема, которую чинила Волна 2 (см. `ROADMAP.md`).

## Обязательный метаблок каждого `*.user.js`

`@name`, `@namespace` (уникальный, не дефолтный), `@version` (SemVer, повышать при
любом изменении логики), `@match` (точный, никогда `*://*/*`), `@grant` (только то,
что реально используется в коде), `@connect` (по одному на хост для каждого
`GM_xmlhttpRequest`, никогда `*`), `@run-at` (обоснованный выбор — `document-start`
только если нужно перехватить что-то до парсинга HTML/рендера, иначе `document-end`),
`@sandbox` (`DOM` по умолчанию; `JavaScript`/`raw` только с явным комментарием, зачем
нужен `unsafeWindow`).

## Ключевые инварианты каркаса (см. `lib/agis-core.js` для реализации)

- Работа с DOM всегда через `waitForElement()` / `observeAddedElements()` —
  никогда `setInterval`-поллинг и никогда прямой `document.querySelector` в момент
  старта (на `document-start` DOM ещё может быть не готов).
- `MutationObserver` вешается на конкретный root (`document.body`/`documentElement`),
  не на `window`.
- SPA-навигация ловится через `onUrlChange()` (перехват `pushState`/`replaceState`
  + `popstate`/`hashchange`), вызывается **ровно один раз** за жизнь страницы.
  `cleanupRoute()` вызывается первым действием в каждом `bootstrap()`.
- `createRouteTokenController()` (из ядра) — `.next()` вызывается первым
  действием в `bootstrap()`, `.isCurrent(token)` проверяется после каждого
  `await` (после `waitForElement`, после парсинга, после `storageGet`, после
  сетевого запроса) — иначе можно отрендерить данные устаревшего маршрута
  после SPA-перехода.
- `pagehide` вызывает `cleanup()` (все таймеры + все observer'ы) и стоп-функцию
  `onUrlChange`.
- `GM_getValue`/`GM_setValue` — асинхронные, всегда `await` + `try/catch`
  (`storageGet`), частые записи — только через debounce (`storageSetDebounced`).
  Ключи кэша должны включать версию на случай смены формата — либо через
  отдельную константу `CACHE_VERSION` (нужна, когда ключ строится динамически,
  как в `agis-loan-info-navbar.user.js`), либо суффиксом прямо в статической
  строке (`agis:duplicate-income:payload:v1` и т.п., большинство скриптов).
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
