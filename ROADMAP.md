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
- `core-template.user.js` всё ещё существует как отдельный самостоятельный userscript-канон, а не как пример-потребитель `lib/agis-core.js` — см. открытый вопрос в Волне 2.

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
- [ ] `core-template.user.js` всё ещё существует как отдельный самостоятельный userscript-канон. Открытый вопрос: превращать ли его в `templates/example-consumer.user.js` (пример потребителя `lib/agis-core.js`) теперь, когда все 7 production-скриптов реально мигрированы и служат живыми примерами использования ядра.

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
| Волна 2 (`@require` ядро) | максимальный | 1 день | ✅ завершено (все 7 скриптов) |
| Волна 3 (UX-унификация) | средний | 1 день | ✅ завершено |
| Волна 4.1 + 4.2 (lint / prettier) | средний | 2 ч | не начато |
| Волна 4.3–4.5 (CI + релиз) | средний | 1 день | не начато |
| Волна 5 (TS + тесты) | низкий, растущий | несколько вечеров | не начато |

---

## Что взять первым

1. Решить судьбу `core-template.user.js` — оставить каноном-документацией или переоформить в `templates/example-consumer.user.js` (открытый вопрос из Волны 2).
2. Волна 4.1/4.2 (ESLint + Prettier) — следующий по приоритету незавершённый трек.

---

## Ссылки

- Канонический шаблон: [`core-template.user.js`](./core-template.user.js)
- Стандарты и чек-лист: [`README.md`](./README.md)
- Policy AI-ассистента: [`space-prompt.md`](./space-prompt.md)
- Обучающее пояснение: [`template-tamper-monkey.md`](./template-tamper-monkey.md)
