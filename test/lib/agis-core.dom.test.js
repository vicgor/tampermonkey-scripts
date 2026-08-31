// @vitest-environment jsdom
// Тесты на waitForCondition/waitForElement ядра (v1.4.0). Нужен DOM — отдельный
// jsdom-файл, чтобы не переводить весь test/lib/agis-core.test.js в jsdom.
import { describe, it, expect, afterEach } from 'vitest';

const { waitForCondition, waitForElement, cleanupRoute } = require('../../lib/agis-core.js');

afterEach(() => {
  cleanupRoute();
  document.body.innerHTML = '';
});

describe('waitForCondition', () => {
  it('резолвится синхронно, если условие уже выполнено', async () => {
    document.body.innerHTML = '<span id="ready">ДС на счету: 1 000,00 ₽</span>';
    const value = await waitForCondition(() => document.querySelector('#ready')?.textContent);
    expect(value).toContain('ДС на счету');
  });

  it('дожидается узла, добавленного позже', async () => {
    const pending = waitForCondition(() => document.querySelector('#late'), { timeout: 2000 });
    setTimeout(() => {
      const el = document.createElement('div');
      el.id = 'late';
      document.body.appendChild(el);
    }, 20);
    await expect(pending).resolves.toBeTruthy();
  });

  it('реагирует на изменение текста без добавления узлов (characterData)', async () => {
    document.body.innerHTML = '<span id="amount">загрузка…</span>';
    const node = document.querySelector('#amount');
    const pending = waitForCondition(() => (node.textContent.includes('₽') ? node.textContent : null), {
      timeout: 2000,
    });
    setTimeout(() => {
      node.textContent = 'ДС на счету: 500,00 ₽';
    }, 20);
    await expect(pending).resolves.toContain('500,00');
  });

  it('реджектится по таймауту с описанием условия', async () => {
    await expect(waitForCondition(() => null, { timeout: 30, describe: 'депозит' })).rejects.toThrow(/депозит/);
  });

  it('исключение внутри probe не роняет ожидание, а трактуется как «ещё не готово»', async () => {
    await expect(
      waitForCondition(
        () => {
          throw new Error('DOM ещё не готов');
        },
        { timeout: 30 },
      ),
    ).rejects.toThrow(/не выполнено за 30мс/);
  });
});

describe('waitForElement', () => {
  it('остаётся обёрткой над waitForCondition и находит элемент по селектору', async () => {
    document.body.innerHTML = '<div class="box"><b>ok</b></div>';
    const el = await waitForElement('.box b');
    expect(el.textContent).toBe('ok');
  });

  it('сообщение таймаута по-прежнему содержит селектор и слово «не найден»', async () => {
    await expect(waitForElement('#missing', { timeout: 30 })).rejects.toThrow(/#missing.*не найден/);
  });
});
