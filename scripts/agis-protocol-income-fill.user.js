// ==UserScript==
// @name         AGIS - вставка прихода из протокола
// @namespace    agis.protocol.income.fill
// @version      1.8
// @description  Клик по строке протокола сохраняет данные; автопереход на список приходов нужного займа; на странице создания прихода кнопка вставки заполняет форму.
// @match        https://agis.berrycash.ru/admin/supportprocess/domain/supportprocesstask/*/task-protocol/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/create*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/list*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan-overdue/*/income/create*
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-protocol-income-fill.user.js
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==