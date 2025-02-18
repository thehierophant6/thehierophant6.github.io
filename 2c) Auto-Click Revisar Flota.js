// ==UserScript==
// @name         2c) Auto-Click Revisar Flota
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically clicks the "Revisar Flota" button from "2) Abrir Flota" once the plate is found
// @match        https://pro.smartmotion.es/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1) Check if URL has "fotos=1"
    function hasFotosParam() {
        // The URL is something like:
        // https://pro.smartmotion.es/#/contract/card/1234567?fotos=1
        // We'll split on '#' and then '?' to parse out the param
        const hash = location.hash;
        if (!hash) return false;
        const parts = hash.split('?');
        if (parts.length < 2) return false;

        const queryString = parts[1]; // e.g. fotos=1
        const params = new URLSearchParams(queryString);
        return params.has('fotos') && params.get('fotos') === '1';
    }

    // If we do NOT have ?fotos=1, do nothing
    if (!hasFotosParam()) {
        console.log('[Auto-Click Revisar Flota] fotos=1 NOT present. Doing nothing.');
        return;
    }

    console.log('[Auto-Click Revisar Flota] fotos=1 detected. Will auto-click once button appears.');

    let attempts = 0;
    const maxAttempts = 30;
    const intervalId = setInterval(() => {
        attempts++;
        // The "2) Abrir Flota" script eventually calls createSharePointButton()
        // which creates a button with id="sharepoint-button".
        const btn = document.getElementById('sharepoint-button');
        if (btn) {
            console.log('[Auto-Click Revisar Flota] Found the button. Clicking now...');
            btn.click(); // This triggers the two SharePoint tabs to open
            clearInterval(intervalId);
        } else if (attempts >= maxAttempts) {
            console.warn('[Auto-Click Revisar Flota] Timed out. No "Revisar Flota" button found after 30s.');
            clearInterval(intervalId);
        }
    }, 1000);

})();
