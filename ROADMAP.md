# ROADMAP

План работ по улучшению и унификации userscripts репозитория.
Разбит на пять волн от быстрых фиксов до долгосрочной архитектуры.
Каждая волна — самостоятельный PR (или серия PR), выпускается независимо.

---

## Текущее состояние

Волна 1 и Волна 2 полностью завершены — все 7 скриптов на общем ядре.
`lib/agis-core.js` опубликован и реально переиспользуется через `@require` +
SRI-хеш — это уже не «канон на бумаге».

**Скрипты в проде (`scripts/*.user.js`):**

| Скрипт | Версия | `@require lib/agis-core.js` | Комментарий |
|---|---|---|---|
| `agis-loan-info-navbar` | 5.3 | v1.2.0 | Волна 2 завершена (PR #20). Попутно исправлен баг: `\b` не работает на границе кириллицы, статус займа не парсился вообще. Волна 3: локальная `RU_MONTHS` заменена на `ruMonthNumber()` ядра (PR #24) |
| `agis-duplicate-income` | 3.2 | v1.2.0 | Волна 2 завершена (PR #18). Волна 3: инлайн-карта месяцев в `normalizeDate()` заменена на `ruMonthNumber()` ядра (PR #25) |
| `agis-add-income-from-googlesheet` | 4.5 | v1.1.0 | Волна 2 завершена (PR #19). Попутно исправлены баги заполнения формы: селекторы без тега матчились на `sonata-ba-field-container-*` обёртку вместо `<input>`, плюс нужен нативный сеттер `value` |
| `agis-protocol-income-fill` | 2.1 | v1.1.0 | Волна 2 завершена (PR #22) — последний из семи. Попутно унифицирован `showBanner`/`registerDebugToggle`, поправлен тайминг `onUrlChange` (раньше устанавливался после `await`, SPA-переход в первые мгновения мог быть пропущен) |
| `agis-paste-cleaner-amount` | 1.9 | v1.0.0 | Волна 2 завершена (PR #13/#14) — пилот `@require` |
| `agis-linkify-loan-note` | 3.2 | v1.0.0 | Волна 2 завершена (PR #15), debug-toggle await-фикс (PR #21) |
| `agis-rusupport-clipboard` | 2.2.0 | v1.0.0 | Волна 2 завершена (PR #16), debug-toggle await-фикс (PR #21) |

**Оставшиеся расхождения:**

- Волна 3 завершена — см. ниже.
- README запрещает `setInterval`-поллинг для ожидания DOM; `setInterval` внутри `onUrlChange`-реализаций (canon и `lib/agis-core.js`) — не в счёт, это осознанный fallback-поллинг URL раз в секунду на случай пропущенного `pushState`/`popstate`, а не ожидание появления элемента.

**Находки, не отражённые в исходном плане волн:** миграция на общее ядро несколько
раз попутно вскрывала реальные баги, которые предшествовали `@require`-переносу
(код был скопирован 1-в-1, баг просто раньше никто не тестировал руками):
googlesheet — заполнение формы не работало из-за коллизии селекторов и отсутствия
нативного сеттера; navbar — статус займа никогда не отображался из-за `\b` в
регэкспе; linkify/rusupport — `registerDebugToggle()` не был awaited перед первым
`bootstrap()`, из-за чего на некоторых страницах debug-логи могли не появляться
вообще; protocol-income-fill — `onUrlChange` устанавливался после `await`,
рискуя пропустить первый SPA-переход, и migration-логи в трёх скриптах
(googlesheet/duplicate-income/protocol-income-fill) гейтированы debug-флагом,
который на момент их вызова ещё не резолвится, — то есть никогда не печатаются
(в protocol-income-fill исправлено на безусловный `console.log`, в двух других
пока оставлено как есть). Все найдены и закрыты (кроме двух последних
migration-логов) в ходе ручной browser-проверки и внешнего code review перед
мержем каждого PR.

---

## Волна 1 — Быстрые исправления ✅ Завершено

**Цель:** привести все скрипты к минимальному соответствию `README.md` без изменения архитектуры.

- [x] **`linkify-loan-note`** → `document-start` + `waitForElement` + `onUrlChange`, cleanup и `observers` Set. `@match` расширен на все 7 доменов AGIS.
- [x] **`rusupport-clipboard`** → `routeToken`/`createRouteTokenController`, `cleanupRoute`, все 7 доменов. Глобальный `initializedTextarea` убран.
- [x] **`protocol-income-fill`** → `waitForIncomeForm` переведён на `waitForElement`-ы, `@match` расширен на все домены AGIS.
- [x] **`add-income-from-googlesheet`** → DEBUG стал условным.
- [x] **Storage-ключи** → везде префикс `agis:` + суффикс версии.

Каждый скрипт прошёл smoke-test из `README.md` (hard reload, SPA-переход, быстрая смена URL) перед мержем.

---

## Волна 2 — Общее ядро через `@require` ✅ Завершено

**Цель:** сделать общий каркас реально переиспользуемым, а не «каноном на бумаге».

- [x] Создан `lib/agis-core.js`, экспортирует API через `window.__AGIS_CORE__`:
  `debounce`, `cleanupRoute`, `cleanup`, `storageGet`, `storageSet`, `storageSetDebounced`, `storageDelete`, `waitForElement`, `observeAddedElements`, `httpRequest`, `api.getJson/postJson/getHtml`, `onUrlChange`, `createRouteTokenController`, `showBanner`, `registerDebugToggle`.
- [x] Опубликован через GitHub Raw + версионированные теги `v1.0.0`, `v1.1.0` (добавил `storageSet`/`storageDelete` для немедленной, не debounced записи перед навигацией) и `v1.2.0` (добавил `ruMonthNumber`, см. Волна 3) — все **с SRI-хешем** (`#sha256=...`).
- [x] Мигрированы все 7 скриптов: `agis-paste-cleaner-amount` (пилот, PR #13/#14), `agis-linkify-loan-note` (#15), `agis-rusupport-clipboard` (#16), `agis-duplicate-income` (#18), `agis-add-income-from-googlesheet` (#19), `agis-loan-info-navbar` (#20), `agis-protocol-income-fill` (#22).
- [x] Общий паттерн `registerDebugToggle()` — await перед первым `bootstrap()`, а не fire-and-forget (найдено и исправлено сначала в #18, затем унифицировано в linkify/rusupport через #21, сразу учтено в #22 — иначе debug-логи могли не появляться вовсе на страницах, где нужный DOM уже присутствует при старте).
- [x] `core-template.user.js` переоформлен в `templates/example-consumer.user.js` — живой минимальный пример `@require`-потребителя `lib/agis-core.js` (актуальный API, `createRouteTokenController`, `registerDebugToggle` с await перед `bootstrap()`), вместо устаревшего самостоятельного канона с несовместимым API (например, `storageSetDebounced` там была фабрикой, а не прямым вызовом). Ссылки в `CLAUDE.md`/`README.md` обновлены.

**Профит (подтверждено на практике):** каждый мигрированный скрипт похудел на
100–150 строк дублирующего кода; три реальных, ранее незамеченных бага
(googlesheet, navbar, linkify/rusupport — см. «Находки» выше) вскрылись и были
исправлены именно благодаря обязательной ручной browser-проверке каждой миграции
перед мержем — сам перенос на `@require` их не создал, но проверка сделала их
заметными.

**Риск (как и предполагалось):** `@require` подтягивает файл при установке/обновлении,
не в рантайме. Митигация сработала как задумано — `v1.0.0`/`v1.1.0` зафиксированы
по тегу + SRI-хешу, новые возможности (`storageSet`/`storageDelete`) добавлены
только новым тегом `v1.1.0`, без изменения `v1.0.0`.

---

## Волна 3 — Унификация UX и конфига ✅ Завершено

**Цель:** одинаковое поведение и внешний вид скриптов, единый источник справочников.

- [x] **Единый `showBanner`** — сделан в ядре (`window.__AGIS_CORE__.showBanner`, типы `success`/`error`/`info`) и используется во всех 7 скриптах после Волны 2.
- [x] **Единое меню Tampermonkey** — `registerDebugToggle(scriptNs, debugKey)` в ядре, используется во всех 7 скриптах.
- [x] **Единый префикс лога.** Все 7 скриптов используют `[agis:<feature>]` (см. `SCRIPT_NS` в каждом).
- [x] **Общий словарь доменов AGIS.** Добавлена таблица 7 брендов/доменов в `README.md` + пункт в чеклист ревью — все 7 скриптов уже покрывают все домены.
- [x] **Конфиг-объект — пересмотрено по факту.** Проверка по коду показала: `GATEWAY_MAP`, `STATUS_RED/YELLOW/GREEN`, `JIRA_BASE` — однократные потребители (по одному скрипту на каждый), выносить их в общий `@require`'ся файл значило бы городить абстракцию без реальной дедупликации — решили не трогать. Единственное настоящее дублирование — карта «русское название месяца → номер» (`RU_MONTHS` в navbar и инлайн-`months` в `normalizeDate` у duplicate-income) — вынесена как `ruMonthNumber()` в `lib/agis-core.js` (v1.2.0, PR #23) и подключена в обоих потребителях (PR #24, #25).

**Вывод:** не создавать отдельный `config/agis-dictionaries.js` — единственный реальный кандидат на общий код (месяцы) уже живёт в `lib/agis-core.js`, а остальные "словари" из исходного плана были ложной целью (единственный потребитель у каждого).

---

## Волна 4 — Тулинг и релиз

**Цель:** автоматизировать проверки качества и релизы.

### 4.1/4.2 — ESLint + Prettier ✅ Завершено

- [x] **ESLint** (`eslint.config.js`, flat config, ESLint 10): база —
  [`eslint-plugin-userscripts`](https://github.com/Yash-Singh1/eslint-plugin-userscripts)
  для метаблока (`@name`/`@version`/`@grant`/...), плюс кастомные правила:
  `no-restricted-globals` для `fetch` (напоминание про `GM_xmlhttpRequest`),
  `no-restricted-syntax` для `new XMLHttpRequest()` и `setInterval` (требует
  обоснования — обходится через `eslint-disable-next-line` с комментарием),
  `no-restricted-properties` для `innerHTML`. `require-download-url` из
  плагина выключен — не все скрипты используют `@downloadURL` осознанно (см.
  историю commit 551ce34), это не общее требование проекта.
- [x] **Prettier** — 2 пробела (было 2 стиля: 2 и 4), одинарные кавычки, `;`,
  ширина 120. Не форматирует `*.md`.
- [x] Все 9 `.js`-файлов (`lib/agis-core.js`, 7 `scripts/*.user.js`,
  `templates/example-consumer.user.js`) прогнаны через Prettier и проверены
  на 100% AST-эквивалентность до/после (сравнение через `espree`, с учётом
  того что Prettier снимает кавычки с кириллических object-ключей, где это
  синтаксически безопасно) — ни один файл не изменил поведение. Два файла,
  где были реальные (не форматирующие) правки — `agis-loan-info-navbar.user.js`
  (добавлен `cause` к перевыброшенной ошибке, patch 5.3.1→5.3.2) и
  `agis-protocol-income-fill.user.js` (убран неиспользуемый `debounce` import,
  patch 2.1→2.1.1) — найдены самим линтером сразу после настройки.
- [x] `package.json` + `npm run lint`/`format`/`format:check` — см. README.md
  "Инструменты разработки".

### 4.3 — GitHub Actions CI ✅ Частично (`ci.yml`)

- [x] **`ci.yml`** — на каждый PR и push в `main`: `npm ci` + `npm run lint` +
  `npm run format:check` (ESLint уже валидирует метаблок через
  `eslint-plugin-userscripts`, отдельный шаг не нужен). Node 20, с кэшем npm.
  Бейдж статуса в README.md.
- [ ] **`release.yml`** — на push тега `v*`: публикация `dist/*.user.js` в GitHub Release с автогенерируемым `@updateURL` / `@downloadURL`.

### 4.4/4.5 — не начато

- [x] **Инсталлятор.** Таблица «скрипт → что делает → Install» в `README.md` — по одной строке на скрипт (не на бренд: все 7 скриптов уже покрывают все 7 доменов, отдельный install на бренд не нужен), ссылки на `raw.githubusercontent.com/.../main/...` — Tampermonkey распознаёт `.user.js` URL и предложит установку. Все 7 ссылок проверены (`curl` → HTTP 200).
- [x] **Метаблок-валидатор** `scripts/validate-meta.js` (`npm run validate-meta`, в `ci.yml`). Проверено перед реализацией, что реально не покрыто `eslint-plugin-userscripts` (он проверяет только присутствие полей и валидность имён `@grant`, не соответствие использованию) — покрыты все 3 пункта, изначально заявленных в этой задаче:
  - `@grant` vs фактическое использование (карта обёртка → `GM_*` из шапки `lib/agis-core.js`: `storageGet`→`GM_getValue`, `storageSet`/`storageSetDebounced`→`GM_setValue`, `storageDelete`→`GM_deleteValue`, `httpRequest`/`api.*`→`GM_xmlhttpRequest`, `registerDebugToggle`→все три — плюс прямые вызовы `GM_*`). Не хватает — `ERROR`; объявлен, но не используется — `WARNING` (не блокирует CI: карта обёрток может быть неполной для будущих скриптов).
  - `@connect` обязателен и не `*`, если используется `GM_xmlhttpRequest`.
  - `@namespace` уникален и не дефолтный; `@match` не открыт на любой хост (`*://*/*`).
  Не покрыто (сознательно, см. `README.md` "Инструменты разработки"): бамп `@version` при изменении файла — нужен git diff против базовой ветки, отдельная задача (ниже); обоснованность `@sandbox`/`@run-at` — слишком эвристично.
- [ ] **Проверка бампа `@version` на PR** — сравнить `@version` в изменённых `scripts/*.user.js` между базовой веткой и HEAD (`git diff`), упасть, если файл менялся, а `@version` — нет. Требует `fetch-depth` в `ci.yml` (сейчас shallow clone) и аккуратной обработки edge-case'ов (detached HEAD, ref недоступен локально) — не блокировать вслепую.

---

## Волна 5 — Долгосрочно

**Цель:** довести проект до уровня библиотечного качества.
**Приоритет:** по мере появления времени.

- [x] **Unit-тесты парсеров.** `vitest` (`npm test`, см. `README.md` "Тесты"),
  67 тестов в `test/lib/` + `test/scripts/`. Покрыты все самодостаточные чистые
  функции (без DOM/window/GM_*): `ruMonthNumber` (ядро); `parseCSV`, `tokenizeCSV`,
  `pad` (googlesheet); `extractTotal` (duplicate-income); `getTokenRe` (linkify);
  `normalizeText`, `pad2`, `toTwoDigitYear`, `isValidDateParts`, `buildShortDate`,
  `extractValue`, `compactData`, `hasUsefulData` (navbar); `cleanInput`
  (paste-cleaner); `normalizeText`, `parseAmount` (protocol-income-fill);
  `normalizePathKey`, `hasKeyword`, `textHash` (rusupport). Экспорт для тестов —
  guard `if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) { ...; return; }`
  в начале IIFE (или в конце, если функция зависит от констант ниже по файлу —
  случай `ruMonthNumber`/`RU_MONTHS`); в Tampermonkey ни `process`, ни `module`
  не определены, блок мёртвый код. `ci.yml` гоняет `npm test` на каждый PR/push.
  Не покрыто на момент этой записи: `resolveGateway`, `normalizeDate`
  (duplicate-income), `cellText` (duplicate-income/protocol-income-fill),
  `toDateTimeString` (googlesheet, недетерминирован — использует `new Date()`).
- [x] **HTML-фикстуры + jsdom (частично).** `fixtures/agis-loan-edit.html` — реальный
  (анонимизированный) кусок страницы `/admin/agis2/core/loan/<id>/edit`, полученный из
  браузера. Разблокировал jsdom-тесты (`test/scripts/agis-loan-info-navbar.dom.test.js`,
  `// @vitest-environment jsdom`) для `getRowCell`/`getRowValue`/`parseDoc` в
  `agis-loan-info-navbar.user.js`. Заодно стали тестируемы (node-окружение, не нужен jsdom)
  `formatDateDDMMYY`/`applyDateFormatting`/`statusColor` — раньше не экспортировались, т.к.
  зависели от `ruMonthNumber` ядра (недоступной при раннем `return` в старом guard'е) и от
  `STATUS_*`-множеств (TDZ при раннем `return`). Решено переносом `STATUS_*` и `let
  ruMonthNumber` перед guard, который в тестовом окружении делает
  `require('../lib/agis-core.js').ruMonthNumber` вместо дублирования её логики — см.
  `README.md` "Тесты". `@version` бампнут (5.3.2 → 5.3.3, патч — только рефакторинг
  экспорта, поведение не менялось, проверено вручную в браузере).
  Реальная фикстура вскрыла настоящий баг парсинга (не артефакт теста): в `parseDoc`
  `extractValue(dc, 'Просрочен на:', /$/)` не останавливался перед `Дата возврата:`
  (стоп-регексп — только конец строки), поэтому `overdueDays` включал в себя ещё и дату
  возврата. **Исправлено** отдельным PR: стоп-регексп — `/Дата возврата|$/`, тест
  переписан из зафиксированного бага в обычный регрессионный (`@version` 5.4.0 → 5.5.0,
  `CACHE_VERSION` v46 → v47, minor — изменение логики парсинга).
  Также в том же PR (не относится к jsdom, найдено при ручном smoke-test):
  `parseLoanContextFromUrl()` не распознавал секции вне жёсткого whitelist
  (`loan-extended` и т.п.) — навбар не рендерился на этих страницах, хотя `@match`
  их уже пускал. Regexp обобщён на любой `loan-<суффикс>` (`@version` 5.3.3 → 5.4.0,
  `CACHE_VERSION` v45 → v46).
  Осталось: `resolveGateway`/`normalizeDate` (duplicate-income), `cellText`
  (duplicate-income/protocol-income-fill) — фикстуры для других страниц AGIS (списки
  платежей/транзакций) ещё не собраны.
- [ ] **TypeScript** через `.user.ts` + сборку в один `.user.js` через `esbuild` (сохраняя метаблок).
  Даст типизацию `GM_*` API через `@types/tampermonkey`.
- [ ] **Скрипт `bump-version.js`** — автоматом инкрементирует `@version` и обновляет `CHANGELOG.md` при коммите в `scripts/*.user.js`.
- [x] **Устранить дублирование `cellText`/`normalizeText` — этап 1/2: вынос в ядро.**
  `normalizeText`/`cellText` добавлены в `lib/agis-core.js` (по аналогии с `ruMonthNumber`,
  тесты в `test/lib/agis-core.test.js`) — были продублированы в `agis-loan-info-navbar.user.js`/
  `agis-protocol-income-fill.user.js` (обе версии буквально идентичны: nbsp — `\s+` в JS уже
  покрывает его, явный `.replace(/\u00a0/g, ' ')` в protocol-income-fill избыточен — более
  ранняя запись в этом файле про разницу в поведении была неверной, перепроверено `node -e`)
  и заинлайнено в `agis-duplicate-income.user.js`.
  Этап 2 (следующий пункт "Что взять первым"): перевести все три скрипта на
  `window.__AGIS_CORE__.normalizeText`/`cellText` и удалить локальные копии — требует
  **нового тега ядра** (`v1.3.0` + SRI-хеш) и отдельного PR на каждый потребитель, по
  той же схеме, что и `ruMonthNumber` (PR #23 → тег `v1.2.0` → PR #24 на navbar).

---

## Приоритизация

| Задача | Impact | Effort | Статус |
|---|---|---|---|
| Волна 1 (быстрые фиксы) | высокий | 3–4 ч | ✅ завершено |
| Волна 2 (`@require` ядро) | максимальный | 1 день | ✅ завершено (все 7 скриптов) |
| Волна 3 (UX-унификация) | средний | 1 день | ✅ завершено |
| Волна 4.1 + 4.2 (lint / prettier) | средний | 2 ч | ✅ завершено |
| Волна 4.3–4.5 (CI + релиз) | средний | 1 день | частично (`ci.yml` + инсталлятор + валидатор есть, `release.yml`/version-bump-check — отложены) |
| Волна 5 (TS + тесты) | низкий, растущий | несколько вечеров | частично (unit-тесты чистых парсеров ✅) |

---

## Что взять первым

1. Перевести `agis-loan-info-navbar.user.js`/`agis-protocol-income-fill.user.js`/
   `agis-duplicate-income.user.js` на `window.__AGIS_CORE__.normalizeText`/`cellText`,
   удалить локальные копии (этап 2/2 дублирования, см. Волна 5 выше) — после того как
   тег `v1.3.0` ядра будет вырезан и опубликован.
2. Собрать HTML-фикстуры для `resolveGateway`/`normalizeDate`/`cellText` (duplicate-income/protocol-income-fill) — продолжение jsdom-тира.
3. `release.yml` и проверка бампа `@version` на PR — отложены, брать по мере необходимости.

---

## Ссылки

- Общее ядро: [`lib/agis-core.js`](./lib/agis-core.js)
- Живой пример потребителя: [`templates/example-consumer.user.js`](./templates/example-consumer.user.js)
- Стандарты и чек-лист: [`README.md`](./README.md)
- Policy AI-ассистента: [`space-prompt.md`](./space-prompt.md)
- Обучающее пояснение: [`template-tamper-monkey.md`](./template-tamper-monkey.md)
