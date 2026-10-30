import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Инвариант из CLAUDE.md: pagehide вызывает стоп-функцию onUrlChange. Само поведение в Node не
// запустить (скрипт выходит на window-guard'е), поэтому проверяем исходник: результат onUrlChange()
// сохранён в переменную, и эта переменная вызывается. Ошибка «onUrlChange(...) без присваивания»
// уже повторялась в нескольких скриптах.
const ROOT = join(__dirname, '..', '..');
const FILES = [
  ...readdirSync(join(ROOT, 'scripts'))
    .filter((name) => name.endsWith('.user.js'))
    .map((name) => join('scripts', name)),
  join('templates', 'example-consumer.user.js'),
];

describe('pagehide снимает onUrlChange', () => {
  it.each(FILES)('%s', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const calls = source.match(/\bonUrlChange\(/g) || [];
    if (calls.length === 0) return; // скрипт не следит за SPA-навигацией

    // `const stop = onUrlChange(...)` или присваивание ранее объявленной `let stop` (add-income-from-googlesheet).
    const assigned = [...source.matchAll(/(?:\b(?:const|let)\s+|^\s*)(\w+)\s*=\s*onUrlChange\(/gm)].map((m) => m[1]);
    expect(assigned, 'результат onUrlChange() не сохранён в переменную').toHaveLength(calls.length);
    for (const name of assigned) {
      expect(source, `стоп-функция ${name}() нигде не вызывается`).toMatch(new RegExp(`\\b${name}\\(\\)`));
    }
  });
});
