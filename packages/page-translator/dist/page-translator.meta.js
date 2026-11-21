// ==UserScript==
// @name         Page Translator
// @namespace    Violentmonkey Scripts
// @version      1.0.0
// @author       OG-Open-Source
// @description  Tag-free automatic web page translator with custom CSS presentation, CJK spacing, and Traditional/Simplified conversion.
// @downloadURL  https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/dist/page-translator.user.js
// @updateURL    https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/page-translator/dist/page-translator.meta.js
// @match        *://*/*
// @connect      translate-pa.googleapis.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      localhost
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==