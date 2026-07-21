#!/usr/bin/env node
'use strict';

// Волна 4.3 (ROADMAP.md): проверяет, что если scripts/*.user.js изменился в этом PR,
// @version в нём тоже изменился — см. README.md "Версионирование": любое изменение
// (даже тайпо/комментарий) требует хотя бы patch-бампа.
//
// Работает только в контексте PR (нужен GITHUB_BASE_REF от GitHub Actions) — при
// прямом push в main или локальном запуске молча пропускает проверку (exit 0),
// не блокирует npm run lint и не требует git-истории вне CI.

const { execFileSync } = require('child_process');

// execFileSync (не exec/execSync со строкой) — аргументы идут напрямую в git,
// без интерпретации шеллом, даже если baseRef/пути файлов когда-нибудь станут
// менее доверенными, чем сейчас.
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (!baseRef) {
    console.log('[check-version-bump] GITHUB_BASE_REF не задан (не PR-контекст в CI) — пропускаю проверку.');
    return;
  }

  let mergeBase;
  try {
    // Без --depth: PR может быть открыт давно и разойтись с main глубже, чем один
    // коммит назад — на shallow-фетче (--depth=1) merge-base не всегда находится
    // (см. ci.yml: checkout здесь настроен с fetch-depth: 0, полная история).
    git(['fetch', 'origin', baseRef]);
    mergeBase = git(['merge-base', 'FETCH_HEAD', 'HEAD']);
  } catch (error) {
    console.warn('[check-version-bump] не удалось определить base ref — пропускаю проверку:', error.message);
    return;
  }

  const changedFiles = git(['diff', '--name-only', mergeBase, 'HEAD', '--', 'scripts/*.user.js'])
    .split('\n')
    .filter(Boolean);

  if (changedFiles.length === 0) {
    console.log('[check-version-bump] scripts/*.user.js не менялись в этом PR.');
    return;
  }

  let hasErrors = false;
  for (const file of changedFiles) {
    const diff = git(['diff', mergeBase, 'HEAD', '--', file]);
    // +/- строка с @version в unified diff означает, что значение реально менялось —
    // не просто оказалось рядом с другой правкой.
    const versionLineChanged = /^[+-]\s*\/\/ @version\b/m.test(diff);
    if (versionLineChanged) {
      console.log(`[check-version-bump] OK ${file}: @version изменён`);
    } else {
      hasErrors = true;
      console.error(
        `[check-version-bump] ERROR ${file}: изменён, но @version не тронут (см. README.md "Версионирование")`,
      );
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
