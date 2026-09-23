// ==UserScript==
// @name         Hanime1 Download Manager
// @namespace    Violentmonkey Scripts
// @version      1.0.2
// @author       OG-Open-Source
// @description  Replace download links with a native-style quality menu, batch download mode, and in-page downloads without leaving the page.
// @icon         https://vdownload.hembed.com/image/icon/nav_logo.png?secure=HxkFdqiVxMMXXjau9riwGg==,4855471889
// @downloadURL  https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/hanime1-download-manager/dist/hanime1-download-manager.user.js
// @updateURL    https://raw.githubusercontent.com/OG-Open-Source/UserScripts/main/packages/hanime1-download-manager/dist/hanime1-download-manager.meta.js
// @match        *://hanime1.com/*
// @match        *://hanime1.me/*
// @match        *://hanimeone.com/*
// @match        *://hanimeone.me/*
// @match        https://og-open-source.github.io/UserScripts/
// @match        https://og-open-source.github.io/UserScripts/settings/*
// @connect      hanime1.com
// @connect      hanime1.me
// @connect      hanimeone.com
// @connect      hanimeone.me
// @connect      vdownload.hembed.com
// @connect      raw.githubusercontent.com
// @connect      localhost
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==