// ==UserScript==
// @name         AGIS Инфо о займе (все страницы)
// @namespace    agis.loaninfo
// @version      4.7
// @description  Полноширинная строка под навбаром с информацией о займе и цветным статусом
// @icon         https://agis.creditsmile.ru/favicon.ico
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan*
// @match        https://agis.credit7.ru/admin/agis2/core/loan*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan*
// @match        https://agis.credit365.ru/admin/agis2/core/loan*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-info-navbar.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-loan-info-navbar.user.js
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      agis.creditsmile.ru
// @connect      agis.credit7.ru
// @connect      agis.belkacredit.ru
// @connect      agis.berrycash.ru
// @connect      agis.credit365.ru
// @connect      agis.volgazaim.ru
// @connect      agis.moneymania.ru
// ==/UserScript==