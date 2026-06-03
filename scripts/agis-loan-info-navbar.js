// ==UserScript==
// @name         CreditSmile — Инфо о займе (все страницы)
// @namespace    agis.loaninfo
// @version      3.7
// @description  Полноширинная строка под навбаром с информацией о займе + цветной статус
// @icon         https://agis.creditsmile.ru/favicon.ico
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan-collection-agency/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan-collection-agency/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan-collection-agency/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-collection-agency/*
// @match        https://agis.credit7.ru/admin/agis2/core/loan/*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.credit7.ru/admin/agis2/core/loan-collection-agency/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan-collection-agency/*
// @match        https://agis.credit365.ru/admin/agis2/core/loan/*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-overdue/*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-judicial-recovery/*
// @match        https://agis.credit365.ru/admin/agis2/core/loan-collection-agency/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // covers: /loan/123, /loan-overdue/123, /loan-judicial-recovery/123, /loan-collection-agency/123
    const loanId   = (location.pathname.match(/\/loan(?:-[\w-]+)?\/(\d+)\b/) || [])[1];
    if (!loanId) return;

    // path segment up to the ID — used for fallback fetch in getData()
    const loanPath = (location.pathname.match(/(\/admin\/agis2\/core\/loan(?:-[\w-]+)?)\//)[1]);

    // ── Parsing ─────────────────────────────────────────────────────────────

    /**
     * Find a <th> matching labelRegex and return the text of its sibling <td>.
     * @param {Document|Element} doc
     * @param {RegExp} labelRegex
     * @param {boolean} [firstTextOnly=false]
     *   true  — returns only the first non-empty Text node of <td> (before any <br>/<span>).
     *           Used for "Статус" whose cell contains extra <span> tags that textContent
     *           would concatenate without spaces (regression from innerText → textContent).
     *   false — returns full normalised textContent of all child nodes (default).
     */
    function getRowValue(doc, labelRegex, firstTextOnly = false) {
        const headers = doc.querySelectorAll('th');
        for (const th of headers) {
            if (labelRegex.test(th.textContent.trim())) {
                const cell = th.parentElement.querySelector('td');
                if (!cell) continue;
                if (firstTextOnly) {
                    for (const node of cell.childNodes) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const text = node.textContent.trim();
                            if (text) return text;
                        }
                    }
                    return null;
                }
                return cell.textContent.replace(/\s+/g, ' ').trim();
            }
        }
        return null;
    }

    /**
     * Extract a value from a normalised text string between key and stopRegex.
     * @param {string|null} text
     * @param {string} key       — literal start marker
     * @param {RegExp} stopRegex — pattern that marks end of value
     */
    function extractValue(text, key, stopRegex) {
        if (!text) return null;
        const idx = text.indexOf(key);
        if (idx === -1) return null;
        let rest = text.slice(idx + key.length);
        const match = rest.match(stopRegex);
        if (match && match.index > 0) rest = rest.slice(0, match.index);
        return rest.trim().replace(/^[:\s]+/, '') || null;
    }

    /** Parse all required fields from a document (current page or fetched /edit). */
    function parseDoc(doc) {
        const data = {};

        // ── PayDay layout: field "Сумма" ────────────────────────────────────
        const sumCell = getRowValue(doc, /^Сумма$/);
        if (sumCell) {
            data.body  = extractValue(sumCell, 'Тело',            /Вознаграждение|Сумма продл|Штраф|Депозит|Итого|\n|$/);
            data.total = extractValue(sumCell, 'Итого на сегодня', /\n|$/);
        }

        // ── Installment layout: no "Сумма" field ────────────────────────────
        if (!data.body) {
            const contractInfo = getRowValue(doc, /^Общая информация по займу$/);
            if (contractInfo)
                data.body = extractValue(contractInfo, 'Сумма по договору:', /Срок|Количество|Ставка|Платеж|\n|$/);
        }
        if (!data.total) {
            const currentInfo = getRowValue(doc, /^Текущая информация по займу$/);
            if (currentInfo)
                data.total = extractValue(currentInfo, 'Итого задолженность:', /ДС на счету|\n|$/);
        }

        // ── Date field (shared by both layouts) ─────────────────────────────
        const dateCell = getRowValue(doc, /^Дата$/);
        if (dateCell) {
            data.issuedOn    = extractValue(dateCell, 'Выдан:',        /Время выдачи|До:|Продлен|Итого|Просрочен|\n|$/);
            data.dueDate     = extractValue(dateCell, 'До:',           /Продлен|Итого|Просрочен|\n|$/);
            data.totalTerm   = extractValue(dateCell, 'Итого:',        /Просрочен|\n|$/);
            data.overdueDays = extractValue(dateCell, 'Просрочен на:', /\n|$/);
            data.extendedTo  = extractValue(dateCell, 'до:',           /Итого|Просрочен|\n|$/);
        }

        data.priceList = getRowValue(doc, /^Прайслист$/);
        data.loanType  = getRowValue(doc, /^Тип$/);

        // firstTextOnly=true: take only the leading text node before <br>/<span>
        // so "Активный кредит" is not merged with "Начисления остановлены ..."
        data.status = getRowValue(doc, /^Статус\b/, true);

        return data;
    }

    // ── Status colour ────────────────────────────────────────────────────────

    function statusColor(status) {
        if (!status) return null;
        const s = status.toLowerCase();
        if (/просроч|дефолт|цесси|продан|списан|банкрот|аннулир|отказ|расторг/.test(s))
            return { bg: '#f2dede', fg: '#a94442', bd: '#ebccd1' };
        if (/закрыт|погаш|выплач|завершён|завершен|возвращ/.test(s))
            return { bg: '#e7e7e7', fg: '#555',    bd: '#d0d0d0' };
        if (/ожид|обработ|рассмотр|заявк|на проверк|пролонг/.test(s))
            return { bg: '#fcf8e3', fg: '#8a6d3b', bd: '#faebcc' };
        if (/активн|выдан|действ|коллект/.test(s))
            return { bg: '#dff0d8', fg: '#3c763d', bd: '#d6e9c6' };
        return { bg: '#d9edf7', fg: '#31708f', bd: '#bce8f1' };
    }

    // ── Render ───────────────────────────────────────────────────────────────

    function buildItem(label, value, highlight = false) {
        if (!value) return '';
        const labelColor = highlight ? '#d9534f' : '#8a96a3';
        const valueColor = highlight ? '#d9534f' : '#1c2733';
        const fontWeight = highlight ? '700'     : '600';
        return `<span style="display:inline-flex;flex-direction:column;margin:0 16px 0 0;line-height:1.15">
            <span style="font-size:9px;color:${labelColor};text-transform:uppercase;letter-spacing:.4px">${label}</span>
            <span style="font-size:12px;color:${valueColor};font-weight:${fontWeight}">${value}</span>
        </span>`;
    }

    function buildStatusItem(status) {
        if (!status) return '';
        const c = statusColor(status);
        return `<span style="display:inline-flex;flex-direction:column;margin:0 16px 0 0;line-height:1.15">
            <span style="font-size:9px;color:#8a96a3;text-transform:uppercase;letter-spacing:.4px">Статус</span>
            <span style="font-size:12px;font-weight:700;color:${c.fg};background:${c.bg};
                         border:1px solid ${c.bd};border-radius:3px;padding:1px 7px;white-space:nowrap">
                ${status}
            </span>
        </span>`;
    }

    function render(data) {
        if (!data) return;
        const navbar = document.querySelector('.navbar-static-top');
        if (!navbar) return;

        const existing = document.getElementById('cs-loan-bar');
        if (existing) existing.remove();

        const bar = document.createElement('div');
        bar.id = 'cs-loan-bar';
        Object.assign(bar.style, {
            width:        '100%',
            boxSizing:    'border-box',
            display:      'flex',
            flexWrap:     'wrap',
            alignItems:   'center',
            padding:      '6px 16px',
            background:   '#eef3f8',
            borderTop:    '1px solid #d6e0ea',
            borderBottom: '1px solid #d6e0ea',
            fontFamily:   'system-ui,Arial,sans-serif',
        });

        bar.innerHTML =
            buildStatusItem(data.status) +
            buildItem('Выдан',      data.issuedOn) +
            buildItem('До',         data.dueDate) +
            buildItem('Срок',       data.totalTerm) +
            buildItem('Просрочка',  data.overdueDays, !!data.overdueDays) +
            buildItem('Продлен до', data.extendedTo) +
            buildItem('Тело',       data.body) +
            buildItem('Итого',      data.total) +
            buildItem('Прайслист',  data.priceList) +
            buildItem('Тип',        data.loanType) +
            buildItem('Займ',       '#' + loanId);

        navbar.parentNode.insertBefore(bar, navbar.nextSibling);
    }

    // ── Cache & data loading ─────────────────────────────────────────────────

    // _v37 suffix intentionally busts sessionStorage entries written by older versions
    // that cached status:null due to the textContent concatenation bug
    const CACHE_KEY = 'cs_loan_' + loanId + '_v37';
    const CACHE_TTL = 300 * 1000; // 5 minutes

    // hasTable anchors on "Статус" which is present in ALL loan layouts
    // (PayDay, Installment, overdue, etc.) — unlike "Сумма"/"Дата" which
    // are absent in the Installment layout
    function hasTable(doc) {
        return !!getRowValue(doc, /^Статус\b/, true);
    }

    function readCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            return (Date.now() - entry.timestamp > CACHE_TTL) ? null : entry.data;
        } catch (e) { return null; }
    }

    function writeCache(data) {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {}
    }

    async function getData() {
        if (hasTable(document)) {
            const data = parseDoc(document);
            writeCache(data);
            return data;
        }
        const cached = readCache();
        if (cached) return cached;
        try {
            // fallback fetch uses actual path segment, not hardcoded "/loan"
            const resp = await fetch(`${loanPath}/${loanId}/edit`, { credentials: 'include' });
            if (!resp.ok) return null;
            const fetchedDoc = new DOMParser().parseFromString(await resp.text(), 'text/html');
            const data = parseDoc(fetchedDoc);
            writeCache(data);
            return data;
        } catch (e) { return null; }
    }

    getData().then(render);
})();
