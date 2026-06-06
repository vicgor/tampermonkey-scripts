// ==UserScript==
// @name         AGIS - linkify loannote
// @namespace    agis.linkify.loannote
// @version      2.10
// @description  Делает ссылки кликабельными в колонке "Контент" на страницах loannote/list
// @match        https://agis.volgazaim.ru/admin/*/loannote/list*
// @match        https://agis.creditsmile.ru/admin/*/loannote/list*
// @match        https://agis.moneymania.ru/admin/*/loannote/list*
// @match        https://agis.berrycash.ru/admin/*/loannote/list*
// @match        https://agis.belkacredit.ru/admin/*/loannote/list*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NS = 'agis-linkify';
    const JIRA_BASE = 'https://jira.aventus.work/browse/';

    // В @sandbox DOM GM_getValue синхронна — await не требуется.
    let DEBUG = GM_getValue('debug_linkify', false);

    GM_registerMenuCommand(
        `Debug-логи: ${DEBUG ? '✅ вкл' : '⬜ выкл'} — нажмите для переключения`,
        () => {
            DEBUG = !DEBUG;
            GM_setValue('debug_linkify', DEBUG);
            alert(`[${SCRIPT_NS}] Debug-логи ${DEBUG ? 'включены' : 'выключены'}. Обновите страницу.`);
        }
    );

    const processedCells = new WeakSet();

    function log(...args) {
        if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...args);
    }

    function addStyles() {
        if (document.getElementById('tm-loannote-style')) return;
        const style = document.createElement('style');
        style.id = 'tm-loannote-style';
        style.textContent = `
            a.tm-external-link {
                color: #0b69a3 !important;
                text-decoration: underline !important;
                word-break: break-all;
            }
            a.tm-jira-link {
                color: #7b1fa2 !important;
                text-decoration: underline !important;
                font-weight: 600;
                word-break: break-all;
            }
        `;
        document.head.appendChild(style);
    }

    function createLink(url, text, className) {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = text || url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = className;
        return a;
    }

    function isInsideLink(node) {
        let el = node.parentElement;
        while (el) {
            if (el.tagName === 'A') return true;
            el = el.parentElement;
        }
        return false;
    }

    // Обрабатывает 3 паттерна по приоритету:
    // 1. Markdown-ссылка: [text](url)
    // 2. Голый URL: https://...
    // 3. Тикет Jira: RUSUPPORT-12345
    function getTokenRe() {
        return /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\bhttps?:\/\/[^\s<>"'\]]+|\bRUSUPPORT-\d+\b/gi;
    }

    function linkifyTextNode(textNode) {
        if (!textNode.nodeValue || !textNode.nodeValue.trim() || isInsideLink(textNode)) return;

        const text = textNode.nodeValue;
        if (!getTokenRe().test(text)) return;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        const execRe = getTokenRe();

        while ((match = execRe.exec(text)) !== null) {
            const start = match.index;

            if (start > lastIndex) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
            }

            const isMarkdown = match[1] !== undefined;
            const token = match[0];

            if (isMarkdown) {
                const label = match[1];
                const url = match[2];
                const className = /RUSUPPORT-\d+/i.test(url) ? 'tm-jira-link' : 'tm-external-link';
                frag.appendChild(createLink(url, label, className));
            } else if (/^https?:\/\//i.test(token)) {
                const className = /RUSUPPORT-\d+/i.test(token) ? 'tm-jira-link' : 'tm-external-link';
                frag.appendChild(createLink(token, token, className));
            } else {
                frag.appendChild(createLink(JIRA_BASE + token, token, 'tm-jira-link'));
            }

            lastIndex = start + token.length;
        }

        if (lastIndex < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        textNode.parentNode.replaceChild(frag, textNode);
    }

    function processCell(cell) {
        if (!cell || processedCells.has(cell)) return;
        processedCells.add(cell);
        log('processing cell:', cell.innerText.trim());

        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.trim()) nodes.push(node);
        }
        nodes.forEach(linkifyTextNode);
    }

    function scan() {
        const cells = document.querySelectorAll(
            'table.sonata-ba-list td.sonata-ba-list-field-textarea'
        );
        log('content cells found:', cells.length);
        cells.forEach(processCell);
    }

    function observe() {
        let timer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(scan, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function main() {
        log(`init, DEBUG=${DEBUG}`);
        addStyles();
        scan();
        observe();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
