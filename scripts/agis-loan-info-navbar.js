// ==UserScript==
// @name         CreditSmile — Инфо о займе (все страницы)
// @namespace    agis.loaninfo
// @version      3.6
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

    // покрывает: /loan/123, /loan-overdue/123, /loan-judicial-recovery/123, /loan-collection-agency/123
    const loanId = (location.pathname.match(/\/loan(?:-[\w-]+)?\/(\d+)\b/) || [])[1];
    if (!loanId) return;

    // сегмент пути до ID, нужен для резервного fetch в getData()
    const loanPath = (location.pathname.match(/(\/admin\/agis2\/core\/loan(?:-[\w-]+)?)\//)[1]);

    // --- Парсинг -----------------------------------------------------------

    /**
     * @param {Document} doc
     * @param {RegExp} labelRegex
     * @param {boolean} [firstTextOnly=false]
     *   true  — возвращает только первый непустой Text-узел <td>.
     *   Используется для статуса: ячейка содержит <br> и <span> с доп.информацией,
     *   которые textContent склеивает без пробела — регессия от замены innerText → textContent.
     *   false — возвращает полный textContent всех дочерних узлов (default).
     */
    function getRowValue(doc, labelRegex, firstTextOnly = false) {
        const ths = doc.querySelectorAll('th');
        for (const th of ths) {
            if (labelRegex.test(th.textContent.trim())) {
                const td = th.parentElement.querySelector('td');
                if (!td) continue;
                if (firstTextOnly) {
                    // берём только первый непустой Text-узел — то, что идёт до <br> или вложенных <span>
                    for (const node of td.childNodes) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            const t = node.textContent.trim();
                            if (t) return t;
                        }
                    }
                    return null;
                }
                return td.textContent.replace(/\s+/g, ' ').trim();
            }
        }
        return null;
    }

    function extract(text, key, stopRegex) {
        if (!text) return null;
        const idx = text.indexOf(key);
        if (idx === -1) return null;
        let rest = text.slice(idx + key.length);
        const m = rest.match(stopRegex);
        if (m && m.index !== undefined && m.index > 0) rest = rest.slice(0, m.index);
        return rest.trim().replace(/^[:\s]+/, '');
    }

    function parseDoc(doc) {
        const d = {};

        const sumCell = getRowValue(doc, /^Сумма$/);
        if (sumCell) {
            d.telo  = extract(sumCell, 'Тело', /Вознаграждение|Сумма продл|Штраф|Депозит|Итого|\n|$/);
            d.itogo = extract(sumCell, 'Итого на сегодня', /\n|$/);
        }

        const dateCell = getRowValue(doc, /^Дата$/);
        if (dateCell) {
            d.vydan      = extract(dateCell, 'Выдан:', /Время выдачи|До:|Продлен|Итого|Просрочен|\n|$/);
            d.doDate     = extract(dateCell, 'До:', /Продлен|Итого|Просрочен|\n|$/);
            d.srok       = extract(dateCell, 'Итого:', /Просрочен|\n|$/);
            d.prosrochka = extract(dateCell, 'Просрочен на:', /\n|$/);
            d.prodlenDo  = extract(dateCell, 'до:', /Итого|Просрочен|\n|$/);
        }

        d.priceList = getRowValue(doc, /^Прайслист$/);
        d.tip       = getRowValue(doc, /^Тип$/);
        // firstTextOnly=true: берём только головный текст до <br>/<span>,
        // чтобы не сливать воедино «Активный кредитНачисления остановлены...»
        d.status    = getRowValue(doc, /^Статус\b/, true);

        return d;
    }

    // --- Цвет статуса ------------------------------------------------------

    function statusColor(status) {
        if (!status) return null;
        const s = status.toLowerCase();
        if (/просроч|дефолт|цесси|продан|списан|банкрот|аннулир|отказ|расторг/.test(s))
            return { bg: '#f2dede', fg: '#a94442', bd: '#ebccd1' };
        if (/закрыт|погаш|выплач|завершён|завершен|возвращ/.test(s))
            return { bg: '#e7e7e7', fg: '#555', bd: '#d0d0d0' };
        if (/ожид|обработ|рассмотр|заявк|на проверк|пролонг/.test(s))
            return { bg: '#fcf8e3', fg: '#8a6d3b', bd: '#faebcc' };
        if (/активн|выдан|действ|коллект/.test(s))
            return { bg: '#dff0d8', fg: '#3c763d', bd: '#d6e9c6' };
        return { bg: '#d9edf7', fg: '#31708f', bd: '#bce8f1' };
    }

    // --- Рендер ------------------------------------------------------------

    function buildItem(label, val, highlight) {
        if (!val) return '';
        const lblColor = highlight ? '#d9534f' : '#8a96a3';
        const valColor = highlight ? '#d9534f' : '#1c2733';
        const valWeight = highlight ? '700' : '600';
        return `<span style="display:inline-flex;flex-direction:column;margin:0 16px 0 0;line-height:1.15">
            <span style="font-size:9px;color:${lblColor};text-transform:uppercase;letter-spacing:.4px">${label}</span>
            <span style="font-size:12px;color:${valColor};font-weight:${valWeight}">${val}</span>
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

    function render(d) {
        if (!d) return;
        const navbar = document.querySelector('.navbar-static-top');
        if (!navbar) return;

        const old = document.getElementById('cs-loan-bar');
        if (old) old.remove();

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
            buildStatusItem(d.status) +
            buildItem('Выдан', d.vydan) +
            buildItem('До', d.doDate) +
            buildItem('Срок', d.srok) +
            buildItem('Просрочка', d.prosrochka, !!d.prosrochka) +
            buildItem('Продлен до', d.prodlenDo) +
            buildItem('Тело', d.telo) +
            buildItem('Итого', d.itogo) +
            buildItem('Прайслист', d.priceList) +
            buildItem('Тип', d.tip) +
            buildItem('Займ', '#' + loanId);

        navbar.parentNode.insertBefore(bar, navbar.nextSibling);
    }

    // --- Кэш и получение данных --------------------------------------------

    const CACHE_KEY = 'cs_loan_' + loanId;
    const CACHE_TTL = 300 * 1000;

    function hasTable(doc) {
        return !!getRowValue(doc, /^Дата$/) || !!getRowValue(doc, /^Сумма$/);
    }

    function fromCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            return (Date.now() - obj.t > CACHE_TTL) ? null : obj.d;
        } catch (e) { return null; }
    }

    function toCache(d) {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d })); } catch (e) {}
    }

    async function getData() {
        if (hasTable(document)) {
            const d = parseDoc(document);
            toCache(d);
            return d;
        }
        const cached = fromCache();
        if (cached) return cached;
        try {
            // резервный URL строится из фактического сегмента пути (не хардкодим "/loan")
            const resp = await fetch(`${loanPath}/${loanId}/edit`, { credentials: 'include' });
            if (!resp.ok) return null;
            const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
            const d = parseDoc(doc);
            toCache(d);
            return d;
        } catch (e) { return null; }
    }

    getData().then(render);
})();
