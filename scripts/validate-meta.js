#!/usr/bin/env node
'use strict';

// Волна 4.5 (ROADMAP.md): проверяет то, что eslint-plugin-userscripts не покрывает —
// см. README.md "Метаблок-валидатор". Три категории:
//   1. @grant должен соответствовать реальному использованию GM_*/обёрток core в коде
//      (обёртка -> @grant, см. WRAPPER_GRANTS — карта взята из комментария в шапке
//      lib/agis-core.js и проверена построчно по всем 7 текущим скриптам).
//   2. @connect обязателен (и не может быть *), если скрипт использует GM_xmlhttpRequest.
//   3. @namespace уникален и не равен дефолту Tampermonkey; @match не открыт на любой хост.
//   4. SRI: @require на lib/agis-core.js закреплён на существующий git-тег, и #sha256=
//      совпадает с хешем файла в ЭТОМ теге (git show <тег>:lib/agis-core.js) — не с
//      рабочей копией. Проверяются scripts/*.user.js и templates/*.user.js.

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');
const TAMPERMONKEY_DEFAULT_NAMESPACE = 'http://tampermonkey.net/';

// Каждая обёртка core вызывает ровно эти GM_*-функции (проверено чтением
// lib/agis-core.js: storageGet/storageSet/storageSetDebounced/storageDelete/httpRequest/
// api.*/registerDebugToggle — единственные GM-зависимые экспорты ядра).
// Ограничение: детектируется только вызов через точку (`api.getJson(`), не bracket
// notation (`api['getJson'](`) — на текущих 8 скриптах такого нет, при появлении
// потребуется расширить requiredGrants().
const WRAPPER_GRANTS = {
  storageGet: ['GM_getValue'],
  storageSet: ['GM_setValue'],
  storageSetDebounced: ['GM_setValue'],
  storageDelete: ['GM_deleteValue'],
  httpRequest: ['GM_xmlhttpRequest'],
  'api.getJson': ['GM_xmlhttpRequest'],
  'api.postJson': ['GM_xmlhttpRequest'],
  'api.getHtml': ['GM_xmlhttpRequest'],
  registerDebugToggle: ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand'],
};

const RAW_GM_NAMES = [
  'GM_setValue',
  'GM_getValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_xmlhttpRequest',
  'GM_registerMenuCommand',
  'GM_unregisterMenuCommand',
  'GM_addStyle',
  'GM_info',
  'GM_notification',
  'GM_openInTab',
  'GM_setClipboard',
];

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions#escaping
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseMetablock(content, file) {
  const start = content.indexOf('// ==UserScript==');
  const end = content.indexOf('// ==/UserScript==');
  if (start === -1 || end === -1) {
    throw new Error(`${file}: не найден блок // ==UserScript== ... // ==/UserScript==`);
  }
  const header = content.slice(start, end);
  // body — всё после закрывающего тега метаблока; GM_*-паттерны requiredGrants() ищет только здесь.
  const body = content.slice(end + '// ==/UserScript=='.length);

  const fields = {};
  // [ \t]* (не \s+): директивы без значения (например @noframes) не должны "красть"
  // следующую строку — \s+ пересекает перевод строки и сжирает соседнюю // @-директиву.
  const lineRe = /^\/\/[ \t]*@(\S+)[ \t]*(.*)$/gm;
  let match;
  while ((match = lineRe.exec(header))) {
    const [, key, value] = match;
    (fields[key] ||= []).push(value.trim());
  }
  return { fields, body };
}

// Ограничение: регулярки ищут паттерн `имя(` по всему телу файла, включая строки
// и комментарии (например, комментарий "используй GM_setValue(...)" тоже засчитается
// как использование) — на текущих 8 скриптах ложных срабатываний из-за этого нет,
// но при появлении подобных комментариев проверяй результат вручную.
function requiredGrants(body) {
  const required = new Set();

  for (const name of RAW_GM_NAMES) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`);
    if (re.test(body)) required.add(name);
  }

  for (const [wrapper, grants] of Object.entries(WRAPPER_GRANTS)) {
    const re = new RegExp(`\\b${escapeRegExp(wrapper)}\\s*\\(`);
    if (re.test(body)) grants.forEach((g) => required.add(g));
  }

  return required;
}

function matchHost(matchValue) {
  // file:// не имеет сетевого хоста — "file://*/..." легитимный паттерн для локальных
  // файлов, не "открыт на любой хост" в смысле CLAUDE.md (это про http(s)-домены).
  if (matchValue.startsWith('file://')) return null;
  const m = matchValue.match(/^[a-zA-Z*][a-zA-Z*+-]*:\/\/([^/]+)\//);
  return m ? m[1] : null;
}

// @require на ядро: https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/<ref>/lib/agis-core.js[#<хеши>]
// Любой @require, в котором встречается agis-core.js, считается ссылкой на ядро и ОБЯЗАН
// совпасть с этим каноническим видом — иначе ошибка, а не молчаливый пропуск (http://,
// зеркала jsDelivr, refs/tags/..., другой регистр, хвост-комментарий в строке и т.п.).
const CORE_MARKER_RE = /agis-core\.js/i;
const CORE_REQUIRE_RE =
  /^https:\/\/raw\.githubusercontent\.com\/vicgor\/tampermonkey-scripts\/([^/]+)\/lib\/agis-core\.js(?:#(.*))?$/;
// Только релизные теги vX.Y.Z — пре-релизы (v1.5.0-rc1) намеренно не принимаются.
const TAG_RE = /^v\d+\.\d+\.\d+$/;

// Содержимое файла в теге — байты из git-объекта, без EOL-конверсии рабочей копии
// (core.autocrlf на Windows не влияет). Кэш: один git show на тег за запуск.
// Возвращает { content } или { error } — чтобы отличать «нет тега» от «нет git».
const tagFileCache = new Map();
function readCoreAtTag(tag) {
  if (!tagFileCache.has(tag)) {
    let result;
    try {
      const content = execFileSync('git', ['show', `${tag}:lib/agis-core.js`], {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      });
      result = { content };
    } catch (e) {
      if (e.code === 'ENOENT') {
        result = { error: 'git не найден в PATH — проверка SRI невозможна' };
      } else {
        const stderr = String(e.stderr || '').trim();
        result = {
          error:
            `git show ${tag}:lib/agis-core.js не сработал` +
            (stderr ? `: ${stderr}` : '') +
            ' — опечатка в теге, запуск вне репозитория или нет тегов (git fetch --tags)',
        };
      }
    }
    tagFileCache.set(tag, result);
  }
  return tagFileCache.get(tag);
}

function sha256(content) {
  const digest = crypto.createHash('sha256').update(content).digest();
  return { base64: digest.toString('base64'), hex: digest.toString('hex') };
}

// Tampermonkey принимает хеш и в base64 (как у нас), и в hex.
function sriMatches(expected, digest) {
  return expected === digest.base64 || expected.toLowerCase() === digest.hex;
}

// Фрагмент может содержать несколько хешей через запятую (#md5=...,sha256=...) —
// Tampermonkey это допускает; нам нужен sha256.
function extractSha256(fragment) {
  if (!fragment) return null;
  for (const part of fragment.split(',')) {
    const m = part.trim().match(/^sha256=(\S+)$/i);
    if (m) return m[1];
  }
  return null;
}

// readFile(tag) -> { content } | { error }; параметром, чтобы тесты не зависели от git.
// Возвращает { errors, checked } — checked = сколько ссылок на ядро реально проверено.
function checkCoreRequires(requireValues, readFile = readCoreAtTag) {
  const errors = [];
  let checked = 0;
  for (const value of requireValues) {
    if (!CORE_MARKER_RE.test(value)) continue; // чужие библиотеки здесь не проверяем
    checked += 1;

    const m = value.match(CORE_REQUIRE_RE);
    if (!m) {
      errors.push(
        `нестандартная ссылка на ядро "${value}" — ожидается https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/<тег>/lib/agis-core.js#sha256=<хеш> без хвоста в строке`,
      );
      continue;
    }
    const [, ref, fragment] = m;

    if (!TAG_RE.test(ref)) {
      errors.push(
        `@require ядра указывает на "${ref}", а не на тег vX.Y.Z — мутабельная ссылка, SRI сломается при следующем коммите`,
      );
      continue;
    }
    const expected = extractSha256(fragment);
    if (!expected) {
      errors.push(`@require ядра ${ref} без "#sha256=..." — SRI-хеш обязателен`);
      continue;
    }
    const { content, error } = readFile(ref);
    if (error) {
      errors.push(error);
      continue;
    }
    const digest = sha256(content);
    if (!sriMatches(expected, digest)) {
      errors.push(
        `SRI-хеш @require ${ref} не совпадает с lib/agis-core.js в теге: в URL ${expected}, в теге ${digest.base64}`,
      );
    }
  }
  return { errors, checked };
}

function validateFile(file, content, namespaceRegistry) {
  const errors = [];
  const warnings = [];

  const { fields, body } = parseMetablock(content, file);

  // --- @grant vs фактическое использование ---
  const declaredRaw = fields.grant || [];
  const declaredGrants = new Set(declaredRaw.filter((g) => g !== 'none'));
  const required = requiredGrants(body);

  for (const grant of required) {
    if (!declaredGrants.has(grant)) {
      errors.push(`используется функционал, требующий "@grant ${grant}", но он не объявлен`);
    }
  }
  for (const grant of declaredGrants) {
    if (!required.has(grant)) {
      warnings.push(
        `"@grant ${grant}" объявлен, но использование не найдено — проверь вручную (см. README.md "Тесты" про обёртки core)`,
      );
    }
  }

  // --- @connect для GM_xmlhttpRequest ---
  const declaredConnect = fields.connect || [];
  if (required.has('GM_xmlhttpRequest') && declaredConnect.length === 0) {
    errors.push(
      'используется GM_xmlhttpRequest (напрямую или через httpRequest/api.*), но ни один @connect не объявлен',
    );
  }
  if (declaredConnect.includes('*')) {
    errors.push('"@connect *" запрещён (CLAUDE.md: "по одному на хост, никогда *")');
  }

  // --- @namespace ---
  const namespaces = fields.namespace || [];
  if (namespaces.length === 1) {
    const ns = namespaces[0];
    if (ns === TAMPERMONKEY_DEFAULT_NAMESPACE) {
      errors.push(`"@namespace" оставлен дефолтным (${TAMPERMONKEY_DEFAULT_NAMESPACE})`);
    }
    (namespaceRegistry[ns] ||= []).push(file);
  }

  // --- @match не открыт на любой хост ---
  for (const value of fields.match || []) {
    const host = matchHost(value);
    if (host === '*') {
      errors.push(`"@match ${value}" открыт на любой хост — CLAUDE.md требует точный @match`);
    }
  }

  // --- SRI @require ядра ---
  const core = checkCoreRequires(fields.require || []);
  errors.push(...core.errors);
  // Все production-скрипты работают на ядре (CLAUDE.md) — отсутствие @require ядра = ошибка.
  if (core.checked === 0)
    errors.push('нет @require на lib/agis-core.js — все scripts/*.user.js обязаны подключать ядро');

  return { errors, warnings };
}

function listUserScripts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.user.js'))
    .sort();
}

function main() {
  const files = listUserScripts(SCRIPTS_DIR);

  const namespaceRegistry = {};
  const results = [];
  let hasErrors = false;

  for (const file of files) {
    const content = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
    const { errors, warnings } = validateFile(file, content, namespaceRegistry);
    results.push({ file, errors, warnings });
    if (errors.length > 0) hasErrors = true;
  }

  // Дубликаты @namespace обнаруживаются только после разбора всех файлов.
  for (const [ns, filesWithNs] of Object.entries(namespaceRegistry)) {
    if (filesWithNs.length > 1) {
      hasErrors = true;
      for (const file of filesWithNs) {
        const result = results.find((r) => r.file === file);
        result.errors.push(
          `"@namespace ${ns}" не уникален — совпадает с: ${filesWithNs.filter((f) => f !== file).join(', ')}`,
        );
      }
    }
  }

  // Шаблон — не production-скрипт (placeholder-значения @match/@namespace), поэтому из
  // полного набора проверок к нему применяется только SRI: из шаблона копируют @require.
  const templates = listUserScripts(TEMPLATES_DIR);
  for (const file of templates) {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
    const { fields } = parseMetablock(content, file);
    const { errors, checked } = checkCoreRequires(fields.require || []);
    // Шаблон без единой ссылки на ядро — проверять нечего, «0 проверено = OK» не допускаем.
    if (checked === 0) errors.push('в шаблоне нет @require на lib/agis-core.js — SRI проверять нечего');
    results.push({ file: `templates/${file}`, errors, warnings: [] });
    if (errors.length > 0) hasErrors = true;
  }

  let totalWarnings = 0;
  for (const { file, errors, warnings } of results) {
    for (const message of errors) console.error(`[validate-meta] ERROR ${file}: ${message}`);
    for (const message of warnings) console.warn(`[validate-meta] WARN  ${file}: ${message}`);
    totalWarnings += warnings.length;
  }

  console.log(`[validate-meta] проверено файлов: ${files.length} (+ шаблонов: ${templates.length})`);
  if (totalWarnings > 0) console.log(`[validate-meta] warnings: ${totalWarnings}`);
  process.exit(hasErrors ? 1 : 0);
}

if (require.main === module) {
  main();
} else {
  // Для vitest (test/scripts/validate-meta.test.js).
  module.exports = { checkCoreRequires, extractSha256, parseMetablock, sha256, sriMatches };
}
