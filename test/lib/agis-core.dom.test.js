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

  it('по умолчанию не реагирует на смену атрибута (только таймаут)', async () => {
    document.body.innerHTML = '<input id="f" style="display:none">';
    const input = document.querySelector('#f');
    const pending = waitForCondition(() => input.style.display !== 'none' && input, { timeout: 150 });
    setTimeout(() => {
      input.style.display = '';
    }, 20);
    await expect(pending).rejects.toThrow(/не выполнено/);
  });

  it('attributes: true — ловит показ поля через style (v1.5.0)', async () => {
    document.body.innerHTML = '<input id="f" style="display:none">';
    const input = document.querySelector('#f');
    const pending = waitForCondition(() => input.style.display !== 'none' && input, {
      timeout: 2000,
      attributes: true,
    });
    setTimeout(() => {
      input.style.display = '';
    }, 20);
    await expect(pending).resolves.toBe(input);
  });

  it('пустой attributeFilter игнорируется — смена атрибута не ловится', async () => {
    document.body.innerHTML = '<div id="alert" class="alert hidden"></div>';
    const el = document.querySelector('#alert');
    const pending = waitForCondition(() => !el.classList.contains('hidden') && el, {
      timeout: 150,
      attributeFilter: [],
    });
    setTimeout(() => el.classList.remove('hidden'), 20);
    await expect(pending).rejects.toThrow(/не выполнено/);
  });

  it('attributeFilter включает attributes сам и игнорирует прочие атрибуты (v1.5.0)', async () => {
    document.body.innerHTML = '<div id="alert" class="alert hidden"></div>';
    const el = document.querySelector('#alert');
    let calls = 0;
    const pending = waitForCondition(
      () => {
        calls += 1;
        return !el.classList.contains('hidden') && el;
      },
      { timeout: 2000, attributeFilter: ['class'] },
    );
    // probe() вызывается синхронно внутри waitForCondition (сразу и после подключения
    // observer'а), поэтому к этой строке начальные вызовы уже посчитаны — дальше calls
    // растёт только от мутаций, на которые observer подписан.
    const before = calls;
    el.setAttribute('data-noise', '1');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(before);
    el.classList.remove('hidden');
    await expect(pending).resolves.toBe(el);
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

  it('пробрасывает attributeFilter — селектор по классу на существующем узле (v1.5.0)', async () => {
    document.body.innerHTML = '<div class="alert hidden">ok</div>';
    const el = document.querySelector('.alert');
    const pending = waitForElement('.alert:not(.hidden)', { timeout: 2000, attributeFilter: ['class'] });
    setTimeout(() => el.classList.remove('hidden'), 20);
    await expect(pending).resolves.toBe(el);
  });
});
