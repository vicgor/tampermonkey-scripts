# ROADMAP

План работ по улучшению и унификации userscripts репозитория.
Разбит на пять волн от быстрых фиксов до долгосрочной архитектуры.
Каждая волна — самостоятельный PR (или серия PR), выпускается независимо.

---

## Текущее состояние

Волна 1 и Волна 2 (см. ниже) завершены для 6 из 7 скриптов. `lib/agis-core.js`
опубликован и реально переиспользуется через `@require` + SRI-хеш — это уже не
«канон на бумаге».

**Скрипты в проде (`scripts/*.user.js`):**

| Скрипт | Версия | `@require lib/agis-core.js` | Комментарий |
|---|---|---|---|
| `agis-loan-info-navbar` | 5.2 | v1.1.0 | Волна 2 завершена (PR #20). Попутно исправлен баг: `\b` не работает на границе кириллицы, статус займа не парсился вообще |
| `agis-duplicate-income` | 3.1 | v1.1.0 | Волна 2 завершена (PR #18) |
| `agis-add-income-from-googlesheet` | 4.5 | v1.1.0 | Волна 2 завершена (PR #19). Попутно исправлены баги заполнения формы: селекторы без тега матчились на `sonata-ba-field-container-*` обёртку вместо `<input>`, плюс нужен нативный сеттер `value` |
| `agis-paste-cleaner-amount` | 1.9 | v1.0.0 | Волна 2 завершена (PR #13/#14) — пилот `@require` |
| `agis-linkify-loan-note` | 3.2 | v1.0.0 | Волна 2 завершена (PR #15), debug-toggle await-фикс (PR #21) |
| `agis-rusupport-clipboard` | 2.2.0 | v1.0.0 | Волна 2 завершена (PR #16), debug-toggle await-фикс (PR #21) |
| `agis-protocol-income-fill` | 2.0 | — | Волна 1 пройдена (все 7 доменов, свои canon-совместимые `waitForElement`/`onUrlChange`/`routeToken`), **но ещё не переведён на `@require lib/agis-core.js`** — единственный оставшийся скрипт Волны 2 |

**Оставшиеся расхождения:**

- `agis-protocol-income-fill` — единственный скрипт с локальными копиями `waitForElement`/`onUrlChange`/`debounce`/`storageGet` вместо `lib/agis-core.js`. Функционально canon-совместим (Волна 1 пройдена), просто не мигрирован.
- Волна 3 (баннер, `registerDebugToggle`-меню, общий словарь доменов, конфиг-словари) ещё не начата — см. ниже.
- README запрещает `setInterval`-поллинг для ожидания DOM; `setInterval` внутри `onUrlChange`-реализаций (canon и `lib/agis-core.js`) — не в счёт, это осознанный fallback-поллинг URL раз в секунду на случай пропущенного `pushState`/`popstate`, а не ожидание появления элемента.

**Находки, не отражённые в исходном плане волн:** миграция на общее ядро несколько
раз попутно вскрывала реальные баги, которые предшествовали `@require`-переносу
(код был скопирован 1-в-1, баг просто раньше никто не тестировал руками):
googlesheet — заполнение формы не работало из-за коллизии селекторов и отсутствия
нативного сеттера; navbar — статус займа никогда не отображался из-за `\b` в
регэкспе; linkify/rusupport — `registerDebugToggle()` не был awaited перед первым
`bootstrap()`, из-за чего на некоторых страницах debug-логи могли не появляться
вообще. Все три найдены и закрыты в ходе ручной browser-проверки перед мержем.

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

## Волна 2 — Общее ядро через `@require` ✅ Завершено для 6 из 7 скриптов

**Цель:** сделать общий каркас реально переиспользуемым, а не «каноном на бумаге».

- [x] Создан `lib/agis-core.js`, экспортирует API через `window.__AGIS_CORE__`:
  `debounce`, `cleanupRoute`, `cleanup`, `storageGet`, `storageSet`, `storageSetDebounced`, `storageDelete`, `waitForElement`, `observeAddedElements`, `httpRequest`, `api.getJson/postJson/getHtml`, `onUrlChange`, `createRouteTokenController`, `showBanner`, `registerDebugToggle`.
- [x] Опубликован через GitHub Raw + версионированные теги `v1.0.0` и `v1.1.0` (добавил `storageSet`/`storageDelete` для случаев, когда нужна немедленная, не debounced запись перед навигацией) — оба **с SRI-хешем** (`#sha256=...`).
- [x] Мигрированы: `agis-paste-cleaner-amount` (пилот, PR #13/#14), `agis-linkify-loan-note` (#15), `agis-rusupport-clipboard` (#16), `agis-duplicate-income` (#18), `agis-add-income-from-googlesheet` (#19), `agis-loan-info-navbar` (#20).
- [x] Общий паттерн `registerDebugToggle()` — await перед первым `bootstrap()`, а не fire-and-forget (найдено и исправлено сначала в #18, затем унифицировано в linkify/rusupport через #21 — иначе debug-логи могли не появляться вовсе на страницах, где нужный DOM уже присутствует при старте).
- [ ] **`agis-protocol-income-fill`** — единственный немигрированный скрипт. План миграции идентичен остальным: заменить локальные `waitForElement`/`onUrlChange`/`debounce`/`storageGet`/`routeToken` на `window.__AGIS_CORE__`, `@require` тег `v1.1.0` + SRI-хеш, сохранить предметную логику (парсинг протокола, заполнение формы) без изменений. Скорее всего самый крупный из оставшихся по объёму специфичного кода — стоит выделить отдельный PR, как и для остальных шести.
- [ ] `core-template.user.js` всё ещё существует как отдельный самостоятельный userscript-канон — вопрос, превращать ли его в `templates/example-consumer.user.js` (пример потребителя `lib/agis-core.js`), остаётся открытым до завершения миграции последнего скрипта.

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

## Волна 3 — Унификация UX и конфига

**Цель:** одинаковое поведение и внешний вид скриптов, единый источник справочников.
**Оценка:** 1 день. **Приоритет:** после Волны 2, можно параллельно с Волной 4.

- [x] **Единый `showBanner`** — сделан в ядре (`window.__AGIS_CORE__.showBanner`, типы `success`/`error`/`info`) и уже используется в `dup-income`/`googlesheet`/`navbar` через миграцию Волны 2. Остаётся только `protocol-income-fill` — закроется вместе с его миграцией на ядро.
- [x] **Единое меню Tampermonkey** — `registerDebugToggle(scriptNs, debugKey)` в ядре, используется в `linkify`/`rusupport`/`duplicate-income`/`googlesheet`. Остаётся только `protocol-income-fill`.
- [ ] **Общий словарь доменов AGIS.** Ввести правило: **все скрипты покрывают все 7 доменов**, если нет причины для сужения. Причина должна быть в комментарии над `@match`. Список доменов в `README.md` как источник истины.
- [ ] **Конфиг-объект в отдельном файле.** Вынести `GATEWAY_MAP`, `STATUS_RED/YELLOW/GREEN`, `RU_MONTHS`, `JIRA_BASE` в `config/agis-dictionaries.js` и подтягивать через `@require`.
- [ ] **Единый префикс лога.** Все мигрированные скрипты уже используют `[agis:<feature>]` (см. `SCRIPT_NS` в каждом). Осталось свериться с `protocol-income-fill` после его миграции.

---

## Волна 4 — Тулинг и релиз

**Цель:** автоматизировать проверки качества и релизы.
**Оценка:** 2 вечера. **Приоритет:** после Волны 2.

- [ ] **ESLint** с конфигом под userscripts:
  - правила `no-restricted-globals` для `fetch` / `XMLHttpRequest` (напоминание про `GM_xmlhttpRequest`);
  - `no-restricted-syntax` для `setInterval` (требует обоснования в комментарии);
  - `no-inner-html`;
  - база — [`eslint-plugin-userscripts`](https://github.com/Yash-Singh1/eslint-plugin-userscripts).
- [ ] **Prettier** с общими настройками (сейчас в файлах видно 2 стиля отступов: 2 и 4 пробела).
- [ ] **GitHub Actions**:
  - `ci.yml` — на каждый PR: lint + валидация метаблока (`@version`, `@match`, соответствие `@grant` реально используемым GM-функциям).
  - `release.yml` — на push тега `v*`: публикация `dist/*.user.js` в GitHub Release с автогенерируемым `@updateURL` / `@downloadURL`.
- [ ] **Инсталлятор.** Добавить в `README.md` таблицу «скрипт → бренд → Install» с прямыми ссылками на raw-файлы (Tampermonkey автоматически распознаёт `.user.js` URL).
- [ ] **Метаблок-валидатор** `scripts/validate-meta.js`: проверяет что для каждого `GM_xmlhttpRequest` в коде есть `@connect`, для каждого `GM_setValue` / `GM_getValue` — соответствующий `@grant`, `@version` увеличен если файл изменён.

---

## Волна 5 — Долгосрочно

**Цель:** довести проект до уровня библиотечного качества.
**Приоритет:** по мере появления времени.

- [ ] **TypeScript** через `.user.ts` + сборку в один `.user.js` через `esbuild` (сохраняя метаблок).
  Даст типизацию `GM_*` API через `@types/tampermonkey`.
- [ ] **Unit-тесты парсеров.** `parseDoc`, `parseCSV`, `normalizeDate`, `extractTotal` — чистые функции без DOM, легко покрываются `vitest`.
- [ ] **HTML-фикстуры** страниц AGIS в `fixtures/` для локального прогона скрипта без прода (Storybook-like sandbox).
- [ ] **Скрипт `bump-version.js`** — автоматом инкрементирует `@version` и обновляет `CHANGELOG.md` при коммите в `scripts/*.user.js`.

---

## Приоритизация

| Задача | Impact | Effort | Статус |
|---|---|---|---|
| Волна 1 (быстрые фиксы) | высокий | 3–4 ч | ✅ завершено |
| Волна 2 (`@require` ядро) | максимальный | 1 день | 6 из 7 скриптов, `protocol-income-fill` в очереди |
| Волна 4.1 + 4.2 (lint / prettier) | средний | 2 ч | не начато |
| Волна 3 (UX-унификация) | средний | 1 день | не начато — можно начинать, ядро стабильно |
| Волна 4.3–4.5 (CI + релиз) | средний | 1 день | не начато |
| Волна 5 (TS + тесты) | низкий, растущий | несколько вечеров | не начато |

---

## Что взять первым

1. Домигрировать **`agis-protocol-income-fill`** на `lib/agis-core.js` (`@require` тег `v1.1.0` + SRI) — единственный оставшийся скрипт Волны 2. Тот же процесс, что и для остальных шести: PR → ручная browser-проверка → мерж.
2. После этого — Волна 3 (единый `showBanner`/`registerDebugToggle` уже фактически унифицированы через ядро; осталось вынести `GATEWAY_MAP`/`STATUS_*`/`RU_MONTHS`/`JIRA_BASE` в общий словарь и договориться о едином префиксе лога).

---

## Ссылки

- Канонический шаблон: [`core-template.user.js`](./core-template.user.js)
- Стандарты и чек-лист: [`README.md`](./README.md)
- Policy AI-ассистента: [`space-prompt.md`](./space-prompt.md)
- Обучающее пояснение: [`template-tamper-monkey.md`](./template-tamper-monkey.md)
