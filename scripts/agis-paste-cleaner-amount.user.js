// ==UserScript==
// @name         AGIS - очистка вставки в поля суммы
// @namespace    agis.paste.cleaner
// @version      1.6
// @description  Очищает вставку в полях суммы: оставляет только цифры, точки и запятые; первый и последний символ — цифры.
// @match        https://agis.credit7.ru/*/loan*/*/create
// @match        https://agis.creditsmile.ru/*/loan*/*/create
// @match        https://agis.belkacredit.ru/*/loan*/*/create
// @match        https://agis.volgazaim.ru/*/loan*/*/create
// @match        https://agis.credit365.ru/*/loan*/*/create
// @match        https://agis.berrycash.ru/*/loan*/*/create
// @match        https://agis.moneymania.ru/*/loan*/*/create
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-paste-cleaner-amount.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-paste-cleaner-amount.user.js
// @run-at       document-start
// @sandbox      DOM
// @grant        none
// ==/UserScript==