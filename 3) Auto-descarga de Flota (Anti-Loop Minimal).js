// ==UserScript==
// @name         3) Auto-descarga de Flota (Anti-Loop Minimal)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Automatically opens folders and clicks "Descargar" once, without looping infinitely.
// @match        https://oksmarttech.sharepoint.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log('[SP Auto-Download] Script loaded. Current URL:', location.href);

    // Track if we've already clicked "Descargar" on this exact page.
    let hasDownloadedOnThisPage = false;
    // Remember the current URL to detect actual page navigations.
    let lastHref = location.href;

    /**************************************************************
     * 1) Observe for changes in DOM, but only re-initialize if
     *    the browser's address (location.href) has changed.
     **************************************************************/
    const observer = new MutationObserver(() => {
        // If the user navigates inside the SP site to a new URL:
        if (location.href !== lastHref) {
            console.log('[SP Auto-Download] URL changed from', lastHref, 'to', location.href);
            lastHref = location.href;
            hasDownloadedOnThisPage = false; // reset our one-time click
            initializeScript();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    /**************************************************************
     * 2) Main initializer: Check if we are on a search page or
     *    a folder page. Only do the download logic once.
     **************************************************************/
    function initializeScript() {
        console.log('[SP Auto-Download] initializeScript() ->', location.href);

        // If we already downloaded on this exact URL, skip.
        if (hasDownloadedOnThisPage) {
            console.log('[SP Auto-Download] Already downloaded on this page. Skipping.');
            return;
        }

        if (location.href.includes('/search.aspx')) {
            handleSearchPage();
        } else if (
            location.href.includes('/AllItems.aspx') ||
            location.href.includes('/Forms/AllItems.aspx')
        ) {
            handleFolderPage();
        } else {
            console.log('[SP Auto-Download] Not a recognized search or folder URL. Doing nothing.');
        }
    }

    /**************************************************************
     * 3) In search.aspx -> look for folder link(s) and navigate
     **************************************************************/
    function handleSearchPage() {
        console.log('[SP Auto-Download] On search page, looking for folder link...');

        const folderSelectors = [
            'div[data-automationid="search-result-item"] a[href*="AllItems.aspx?FolderCTID="]',
            'div[data-sp-itemtype="Folder"] a',
            'a[href*="AllItems.aspx?"]',
            'a[href*="/sites/okrac/flota/"]'
        ];

        findElementFromList(folderSelectors, (folderLink) => {
            console.log('[SP Auto-Download] Found folder link ->', folderLink.href);
            // Mark this page as "done" so we don't keep navigating repeatedly
            hasDownloadedOnThisPage = true;
            // Navigate to that folder
            window.location.href = folderLink.href;
        });
    }

    /**************************************************************
     * 4) In a folder page -> look for "Descargar" button & click
     **************************************************************/
    function handleFolderPage() {
        console.log('[SP Auto-Download] On folder page, waiting for "Descargar" button...');
        waitForElement('span.ms-Button-label.label-161', () => {
            const spans = document.querySelectorAll('span.ms-Button-label.label-161');
            let foundDescargar = false;

            for (const span of spans) {
                if (span.textContent.trim().toLowerCase().includes('descargar')) {
                    console.log('[SP Auto-Download] Found "Descargar" button:', span);
                    clickDownloadButton(span);
                    foundDescargar = true;
                    break; // no need to check the rest
                }
            }

            if (!foundDescargar) {
                console.warn('[SP Auto-Download] No "Descargar" button found on this folder page.');
                // If truly no button, mark as done so we don't keep searching
                hasDownloadedOnThisPage = true;
            }
        });
    }

    /**************************************************************
     * 5) Click the "Descargar" button -> mark as done
     **************************************************************/
    function clickDownloadButton(descargarSpan) {
        try {
            const btn = descargarSpan.closest('button');
            if (btn) {
                console.log('[SP Auto-Download] Clicking the "Descargar" button now...');
                btn.click();
                // Mark that we've done the download attempt for this page
                hasDownloadedOnThisPage = true;
            } else {
                console.error('[SP Auto-Download] Could not find parent <button> for "Descargar".');
            }
        } catch (error) {
            console.error('[SP Auto-Download] Error while clicking the "Descargar" button:', error);
        }
    }

    /**************************************************************
     * Helper: findElementFromList
     * Given an array of CSS selectors, tries each one repeatedly
     * in a loop, stopping if something is found or times out.
     **************************************************************/
    function findElementFromList(selectors, onFound, interval = 600, timeout = 20000) {
        const start = Date.now();
        let index = 0;

        const timer = setInterval(() => {
            if (Date.now() - start > timeout) {
                clearInterval(timer);
                console.error('[SP Auto-Download] Timeout: no matching element found for any of:', selectors);
                return;
            }

            const sel = selectors[index];
            const el = document.querySelector(sel);
            if (el) {
                clearInterval(timer);
                onFound(el);
                return;
            }

            index++;
            if (index >= selectors.length) {
                index = 0; // cycle
            }
        }, interval);
    }

    /**************************************************************
     * Helper: waitForElement
     * Poll until an element matching `selector` appears or times out
     **************************************************************/
    function waitForElement(selector, onFound, interval = 600, timeout = 20000) {
        const start = Date.now();

        const timer = setInterval(() => {
            if (Date.now() - start > timeout) {
                clearInterval(timer);
                console.error(`[SP Auto-Download] Timeout waiting for selector: "${selector}"`);
                return;
            }

            const el = document.querySelector(selector);
            if (el) {
                clearInterval(timer);
                onFound(el);
            }
        }, interval);
    }

    // Fire the script the first time on page load
    initializeScript();
})();