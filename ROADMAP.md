# ROADMAP

План работ по улучшению и унификации userscripts репозитория.
Разбит на пять волн от быстрых фиксов до долгосрочной архитектуры.
Каждая волна — самостоятельный PR (или серия PR), выпускается независимо.

---

## Текущее состояние

**Скрипты в проде (`scripts/*.user.js`):**

| Скрипт | Версия | Соответствие `core-template.user.js` | Комментарий |
|---|---|---|---|
| `agis-loan-info-navbar` | 4.7 | эталон | Полный routeToken, cleanup, backend fallback |
| `agis-duplicate-income` | 2.5 | 90 % | Захардкожен `GATEWAY_MAP`, локальный banner-код |
| `agis-add-income-from-googlesheet` | 4.1 | 85 % | Локальный `httpRequest`, DEBUG всегда on |
| `agis-protocol-income-fill` | 1.5 | 70 % | `setInterval`-поллинг в `waitForIncomeForm`, `@match` только `berrycash.ru` |
| `agis-paste-cleaner-amount` | 1.6 | 80 % | Своя `waitForElement`/`onUrlChange`, нет `routeToken` |
| `agis-linkify-loan-note` | 2.10 | 40 % | `@run-at document-idle`, свой `MutationObserver` без cleanup, нет `onUrlChange` |
| `agis-rusupport-clipboard` | 1.0.0 | 50 % | Свои утилиты, глобальный `initializedTextarea`, `@match` только `moneymania.ru` |

**Расхождения между скриптами и каноном:**

- `waitForElement`, `debounce`, `onUrlChange`, `storageGet`, `httpRequest` реализованы 3–4 раза каждый.
  `core-template.user.js` объявлен каноном, но не переиспользуется — его нельзя `@require`, потому что он оформлен как самостоятельный userscript.
- Скрипты 4, 6, 7 работают только на одном бренде, хотя логика применима ко всем 7 доменам AGIS.
- Разный `@run-at`: `document-idle` в `linkify`, `document-start` в остальных.
- Storage-ключи без namespace/версии (`agis_dup_income_payload`, `agis_google_sheet_url`).
  В navbar есть `CACHE_VERSION`, в других — нет.
- UI-баннер (зелёная плашка справа сверху) скопипащен в 4 скриптах.
- Debug-флаг через `GM_registerMenuCommand` есть в 3 скриптах из 7.
- Локальные `MutationObserver` без регистрации в `observers` Set → нет cleanup при SPA-навигации (linkify, rusupport).
- README запрещает `setInterval`-поллинг, но `protocol-income-fill.waitForIncomeForm()` использует именно его.

---

## Волна 1 — Быстрые исправления

**Цель:** привести все скрипты к минимальному соответствию `README.md` без изменения архитектуры.
**Оценка:** 3–4 часа. **Приоритет:** сделать первым.

- [ ] **`linkify-loan-note`** → перевести на `document-start` + `waitForElement` + `onUrlChange`, добавить cleanup и `observers` Set. Расширить `@match` на все 7 доменов AGIS.
- [ ] **`rusupport-clipboard`** → добавить `routeToken`, `cleanupRoute`, расширить `@match` на все 7 доменов. Убрать глобальный `initializedTextarea`, использовать `WeakSet` как в `paste-cleaner-amount`.
- [ ] **`protocol-income-fill`** → заменить `while (Date.now() - started < 10000)` из `waitForIncomeForm` на `Promise.race` из `waitForElement`-ов. Расширить `@match` на все домены AGIS (не только berrycash).
- [ ] **`add-income-from-googlesheet`** → DEBUG сделать условным (сейчас `log` всегда пишет в консоль независимо от флага).
- [ ] **Storage-ключи** → везде добавить префикс `agis:` и суффикс версии, например `agis_dup_income_payload` → `agis:dup-income:payload:v1`.

**Как проверять:** каждый скрипт проходит smoke-test из `README.md` (Chrome + Firefox, hard reload, SPA-переход между двумя займами, быстрая смена URL).

---

## Волна 2 — Общее ядро через `@require`

**Цель:** сделать `core-template.user.js` реально переиспользуемым, а не «каноном на бумаге».
**Оценка:** 1 день. **Приоритет:** сразу после Волны 1.

**План:**

- [ ] Создать `lib/agis-core.js`, экспортирующий API через `window.__AGIS_CORE__`:
  `waitForElement`, `observeAddedElements`, `debounce`, `storageGet`, `storageSetDebounced`, `httpRequest`, `api.getJson/postJson/getHtml`, `onUrlChange`, `createRouteTokenController`, `showBanner`, `registerDebugToggle`.
- [ ] Публиковать через GitHub Raw + версионированный тег:
  `https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.0.0/lib/agis-core.js` **с SRI-хешем** (`#sha256=...`).
- [ ] В каждом скрипте:
  ```js
  // @require https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.0.0/lib/agis-core.js#sha256=...
  const { waitForElement, api, onUrlChange, showBanner } = window.__AGIS_CORE__;
  ```
- [ ] В каждом скрипте остаётся только предметная логика (парсинг ячеек, маппинг шлюзов, формат даты).
- [ ] `core-template.user.js` → превратить в `templates/example-consumer.user.js` (пример использования `lib/agis-core.js`), а сам файл ядра пометить как canonical library.

**Профит:** минус ~200–300 строк дубля в каждом скрипте; фиксы делаются в одном месте; версия ядра видна в метаблоке.

**Риск:** `@require` подтягивает файл при установке/обновлении, не в рантайме. При смене SRI-хеша скрипт откажется работать до ручного обновления. **Митигация** — фиксировать major-версию (`v1/`) и не менять публичное API внутри мажора.

---

## Волна 3 — Унификация UX и конфига

**Цель:** одинаковое поведение и внешний вид скриптов, единый источник справочников.
**Оценка:** 1 день. **Приоритет:** после Волны 2, можно параллельно с Волной 4.

- [ ] **Единый `showBanner`** в ядре с типами `success` / `error` / `info` — заменить 4 копипаста в скриптах (`dup-income`, `googlesheet`, `protocol-fill`, `rusupport`).
- [ ] **Единое меню Tampermonkey** через ядро: `registerDebugToggle(scriptNs)` — три скрипта используют почти идентичный шаблон.
- [ ] **Общий словарь доменов AGIS.** Ввести правило: **все скрипты покрывают все 7 доменов**, если нет причины для сужения. Причина должна быть в комментарии над `@match`. Список доменов в `README.md` как источник истины.
- [ ] **Конфиг-объект в отдельном файле.** Вынести `GATEWAY_MAP`, `STATUS_RED/YELLOW/GREEN`, `RU_MONTHS`, `JIRA_BASE` в `config/agis-dictionaries.js` и подтягивать через `@require`.
- [ ] **Единый префикс лога.** Сейчас в navbar `[CreditSmileLoanInfo]`, в rusupport `[AGIS RUSUPPORT Clipboard]`, остальные `[agis-xxx]`. Договориться: везде `[agis:<feature>]`, где `<feature>` = имя файла без префикса и суффикса.

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

| Задача | Impact | Effort | Порядок |
|---|---|---|---|
| Волна 1 (быстрые фиксы) | высокий | 3–4 ч | **сделать первым** |
| Волна 2 (`@require` ядро) | максимальный | 1 день | сделать вторым |
| Волна 4.1 + 4.2 (lint / prettier) | средний | 2 ч | параллельно с Волной 2 |
| Волна 3 (UX-унификация) | средний | 1 день | после Волны 2 |
| Волна 4.3–4.5 (CI + релиз) | средний | 1 день | когда стабилизируется API ядра |
| Волна 5 (TS + тесты) | низкий, растущий | несколько вечеров | по желанию |

---

## Что взять первым (30 минут)

1. Открыть 4 issue: **Wave 1.1 linkify → core**, **Wave 1.2 rusupport routes**, **Wave 1.3 protocol interval**, **Wave 2 `@require` lib**.
2. Взять самый криминальный пункт — `protocol-income-fill.waitForIncomeForm` с `setInterval`-циклом — и заменить на `waitForElement` из ядра. Одиночный PR на ~20 строк, снимает нарушение собственного чек-листа.

---

## Ссылки

- Канонический шаблон: [`core-template.user.js`](./core-template.user.js)
- Стандарты и чек-лист: [`README.md`](./README.md)
- Policy AI-ассистента: [`space-prompt.md`](./space-prompt.md)
- Обучающее пояснение: [`template-tamper-monkey.md`](./template-tamper-monkey.md)
