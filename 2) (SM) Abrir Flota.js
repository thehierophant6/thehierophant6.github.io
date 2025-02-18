// ==UserScript==
// @name         2) (SM) Abrir Flota
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Matches plates 5–8 chars only, ignoring shorter/longer tokens
// @match        https://pro.smartmotion.es/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    /*************************************************************
     * A) Regex Patterns (Order Matters)
     *    We skip any token <5 or >8 chars, so these patterns only
     *    apply to tokens exactly 5–8 in length. Examples:
     *    - Spain "1234ABC" => 7 chars
     *    - Italy "AB123CD" => 7 chars
     *    - Portugal "12-34-AB" => 8 chars
     *    - Germany "MQG1219" => 7 chars
     *    - US, we require at least 1 digit, total 5–8 chars
     *************************************************************/
    const platePatterns = [
        // 1) Spain: 1234ABC
        /^[0-9]{4}[A-Z]{3}$/i,

        // 2) Italy: AB123CD
        /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/i,

        // 3) Portugal: 12-34-AB
        /^[0-9]{2}-[0-9]{2}-[A-Z]{2}$/i,

        // 4) Germany (simplified): 1–3 letters, optional dash, 0–2 letters, 1–4 digits
        /^[A-Z]{1,3}-?[A-Z]{0,2}[0-9]{1,4}$/i,

        // 5) Greece: ABC1234 (7 chars)
        /^[A-Z]{3}[0-9]{4}$/i,

        // 6) Malta: AAA 123 (6 or 7 chars if space is included)
        /^[A-Z]{3}\s?[0-9]{3}$/i,

        // 7) France: AA-123-AA (8 chars)
        /^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$/i,

        // 8) Croatia: ZG 1234 AB (could be 7 or 8 chars with spaces)
        /^[A-Z]{1,3}\s?[0-9]{3,4}\s?[A-Z]{1,2}$/i,

        // 9) Serbia/Montenegro/BiH/Etc.: e.g. BG 456-KL (7 or 8 chars)
        /^[A-Z]{1,2}\s?[0-9]{3}-[A-Z]{1,2}$/i,

        // 10) Morocco: 12345-67 (7 or 8 chars)
        /^[0-9]{5}-[0-9]{1,2}$/,

        // 11) Turkey: 34 ABC 123 (could be 7 or 8 chars)
        /^[0-9]{1,2}\s?[A-Z]{1,3}\s?[0-9]{1,4}$/i,

        // 12) Albania: AA 123 BB (7 or 8 chars)
        /^[A-Z]{2}\s?[0-9]{3}\s?[A-Z]{2}$/i,

        // 13) Gambia: BJL 1234 (7 or 8 chars)
        /^[A-Z]{3}\s?[0-9]{1,4}$/i,

        // 14) Tunisia: 1234 TN 56 (8 or 9 total, but 9 we skip, so we might catch 8)
        /^[0-9]{4}\s?TN\s?[0-9]{1,2}$/i,

        // 15) Poland: AB 12345 (6 or 7 chars if space is included)
        /^[A-Z]{1,2}\s?[0-9]{4,5}$/i,

        // 16) Senegal: 1234-AB-56 (8 chars)
        /^[0-9]{4}-[A-Z]{2}-[0-9]{1,2}$/i,

        // 17) UAE: 1 12345 (e.g. "7 34567" => 6 or 7 chars)
        /^[0-9]{1}\s?[0-9]{1,5}$/,

        // 18) US: 5–8 chars, must contain at least 1 digit
        /^(?=.*\d)[A-Z0-9]{5,8}$/i,
    ];

    /*************************************************************
     * B) Core Logic
     *************************************************************/
    function isContractCardPage() {
        return window.location.href.includes('/#/contract/card/');
    }

    function getContractNumberFromUrl() {
        const match = window.location.href.match(/\/contract\/card\/(\d+)/);
        return (match && match[1]) ? match[1] : null;
    }

    /**
     * Splits the page text into tokens, skipping anything <5 or >8 chars.
     * For each token, run the above patterns in order. Return first match.
     */
    function findPlateByPatterns() {
        const text = document.body.innerText;
        // Split on whitespace/punctuation
        const tokens = text.split(/[\s\n\t,;:<>/\\(){}\[\]\.]+/);

        for (const token of tokens) {
            const len = token.length;
            // Skip tokens outside 5–8 chars
            if (len < 5 || len > 8) continue;

            for (const pattern of platePatterns) {
                if (pattern.test(token)) {
                    return token.toUpperCase();
                }
            }
        }
        return null;
    }

    function createSharePointButton(contractUrl, plateUrl) {
        // Remove any existing button
        const existing = document.getElementById('sharepoint-button');
        if (existing) existing.remove();

        const btn = document.createElement('button');
        btn.id = 'sharepoint-button';
        btn.textContent = 'Revisar Flota';
        btn.style.position = 'fixed';
        btn.style.top = '50px';
        btn.style.right = '10px';
        btn.style.zIndex = '9999';
        btn.style.padding = '10px';
        btn.style.backgroundColor = '#007bff';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.cursor = 'pointer';

        btn.addEventListener('click', () => {
            // 1) Open contract
            window.open(contractUrl, '_blank');
            // 2) Open plate
            window.open(plateUrl, '_blank');
        });

        document.body.appendChild(btn);
        console.log('[CRM SharePoint] Button created.');
    }

    function pollForPlate(contractNum, maxAttempts = 30) {
        console.log('[CRM SharePoint] Polling for plate...');

        // MINIMAL CHANGE #1: add &autodownload=1 at the end
        const contractUrl = `https://oksmarttech.sharepoint.com/sites/okrac/flota/_layouts/15/search.aspx/siteall?q=${contractNum}&autodownload=1`;

        let attempts = 0;
        const intervalId = setInterval(() => {
            attempts++;
            const foundPlate = findPlateByPatterns();
            if (foundPlate) {
                clearInterval(intervalId);
                console.log(`[CRM SharePoint] Found plate: ${foundPlate} (after ${attempts} attempts)`);

                // MINIMAL CHANGE #2
                const plateUrl = `https://oksmarttech.sharepoint.com/sites/okrac/flota/_layouts/15/search.aspx/siteall?q=${encodeURIComponent(foundPlate)}&autodownload=1`;

                createSharePointButton(contractUrl, plateUrl);
            } else if (attempts >= maxAttempts) {
                clearInterval(intervalId);
                console.warn('[CRM SharePoint] No plate found, using empty plate search.');

                // MINIMAL CHANGE #3
                const emptyPlateUrl = 'https://oksmarttech.sharepoint.com/sites/okrac/flota/_layouts/15/search.aspx/siteall?q=&autodownload=1';

                createSharePointButton(contractUrl, emptyPlateUrl);
            }
        }, 1000);
    }

    function initSharePointIntegration() {
        console.log('[CRM SharePoint] initSharePointIntegration() triggered.');
        const contractNum = getContractNumberFromUrl();
        if (!contractNum) {
            console.warn('[CRM SharePoint] No contract number found in URL.');
            return;
        }
        pollForPlate(contractNum, 30);
    }

    // Watch for SPA changes
    let lastUrl = location.href;
    new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            if (isContractCardPage()) {
                initSharePointIntegration();
            }
        }
    }).observe(document, { subtree: true, childList: true });

    // Run once on load
    if (isContractCardPage()) {
        initSharePointIntegration();
    }

})();