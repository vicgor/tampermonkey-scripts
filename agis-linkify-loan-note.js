// ==UserScript==
// @name         AGIS loannote linkify
// @namespace    victor.goryachko.tm
// @version      2.5
// @description  Делает ссылки кликабельными в колонке "Контент" на страницах loannote/list
// @include      https://agis.*/admin/*loannote/list*
// @include      http://agis.*/admin/*loannote/list*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const JIRA_BASE = 'https://jira.aventus.work/browse/';
    const DEBUG = false;

    // Создаём regex локально, чтобы избежать проблем с shared lastIndex
    function getTokenRe() {
        return /\bhttps?:\/\/[^\s<>"')\]]+|\bRUSUPPORT-\d+\b/gi;
    }

    const processedCells = new WeakSet();

    function log(...args) {
        if (DEBUG) console.log('[TM loannote]', ...args);
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

    function findTargetTables() {
        return Array.from(document.querySelectorAll('table')).filter(table => {
            const text = (table.innerText || '').replace(/\s+/g, ' ');
            return text.includes('Контент') && text.includes('Владелец') && text.includes('Важно');
        });
    }

    function findContentColumnIndex(table) {
        const firstRow = table.querySelector('tr');
        if (!firstRow) return -1;

        const headers = Array.from(firstRow.children).map(cell =>
            (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim()
        );

        log('headers:', headers);
        return headers.findIndex(text => text.includes('Контент'));
    }

    function isInsideLink(node) {
        let el = node.parentElement;
        while (el) {
            if (el.tagName === 'A') return true;
            el = el.parentElement;
        }
        return false;
    }

    function createLink(url, className, text) {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = text || url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = className;
        return a;
    }

    function linkifyTextNode(textNode) {
        const text = textNode.nodeValue;
        if (!text || !text.trim() || isInsideLink(textNode)) return;

        const tokenRe = getTokenRe();
        if (!tokenRe.test(text)) return;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        const execRe = getTokenRe();

        while ((match = execRe.exec(text)) !== null) {
            const token = match[0];
            const start = match.index;

            if (start > lastIndex) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
            }

            if (/^https?:\/\//i.test(token)) {
                frag.appendChild(createLink(token, 'tm-external-link'));
            } else if (/^RUSUPPORT-\d+$/i.test(token)) {
                frag.appendChild(createLink(JIRA_BASE + token, 'tm-jira-link', token));
            } else {
                frag.appendChild(document.createTextNode(token));
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

        log('processing cell:', cell.innerText);

        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;

        while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.trim()) {
                nodes.push(node);
            }
        }

        nodes.forEach(linkifyTextNode);
    }

    function processTable(table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length < 2) {
            log('not enough rows');
            return;
        }

        const contentIdx = findContentColumnIndex(table);
        log('contentIdx =', contentIdx);

        if (contentIdx < 0) return;

        rows.slice(1).forEach((row, rowIndex) => {
            const cells = row.children;
            if (!cells || cells.length <= contentIdx) return;
            log('row', rowIndex + 1, 'content =', cells[contentIdx].innerText);
            processCell(cells[contentIdx]);
        });
    }

    function scan() {
        const tables = findTargetTables();
        log('scan on', location.href, 'tables found:', tables.length);
        tables.forEach(processTable);
    }

    function observe() {
        let scanning = false;
        let timer = null;

        const observer = new MutationObserver(() => {
            if (scanning) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                scanning = true;
                scan();
                scanning = false;
            }, 300);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    function main() {
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
