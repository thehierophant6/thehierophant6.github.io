// ==UserScript==
// @name         (SM) Descarga de Documentación
// @namespace    http://tampermonkey.net/
// @version      2.12
// @description  1) Download SmartSign docs. 2) For each "Factura simplificada": open invoice, poll up to 15s for "Imprimir", click it once, wait 5s, then close. 3) On main page, click "Ver Checkin", open checkin tab, poll up to 10s for an ok-button with text "action.report", click its inner button once, wait 2s, then close the checkin tab.
// @match        https://pro.smartmotion.es/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Global set to ensure each invoice is processed only once per session.
    if (!window.__processedInvoices) {
        window.__processedInvoices = new Set();
    }

    // Utility: Normalize text by replacing multiple spaces/newlines with a single space.
    function normalizeText(txt) {
        return txt.replace(/\s+/g, ' ').trim();
    }

    // Check if we are on a Contract Card page.
    function isContractCardPage() {
        return window.location.href.includes('/#/contract/card/');
    }

    // Insert the main "Descargar Docu" button if not already present.
    function addDownloadButton() {
        if (document.getElementById('downloadAllFilesButton')) return;

        const btn = document.createElement('button');
        btn.id = 'downloadAllFilesButton';
        btn.innerText = 'Descargar Docu';
        Object.assign(btn.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            zIndex: '1000',
            padding: '10px',
            backgroundColor: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
        });
        document.body.appendChild(btn);

        // Helper: simulate a click.
        function simulateClick(el) {
            const evt = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            el.dispatchEvent(evt);
        }

        //----------------------------------------------------------------------
        // Step 1: Download the 3 SmartSign docs in sequence.
        //----------------------------------------------------------------------
        function downloadSmartSignDocs(onDone) {
            console.log('[TM] Iniciando descarga de SmartSign...');
            const items = [
                'Descargar de Smart Sign',
                'Descargar condiciones',
                'Descargar desistimiento'
            ];
            let idx = 0;
            function doNext() {
                if (idx >= items.length) {
                    console.log('[TM] Descarga de SmartSign finalizada.');
                    if (onDone) onDone();
                    return;
                }
                const menuButton = document.querySelector('.ui-splitbutton-menubutton');
                if (!menuButton) {
                    console.log('[TM] No se encontró el menú principal de descargas. Omitiendo SmartSign...');
                    if (onDone) onDone();
                    return;
                }
                simulateClick(menuButton);
                setTimeout(() => {
                    const matches = Array.from(document.querySelectorAll('.ui-menuitem-text'));
                    const nameToFind = items[idx];
                    const found = matches.find(m => normalizeText(m.textContent) === nameToFind);
                    if (found) {
                        const anchor = found.closest('a');
                        if (anchor) {
                            simulateClick(anchor);
                            console.log(`[TM] Descargando: ${nameToFind}`);
                        }
                    } else {
                        console.log(`[TM] No se encontró "${nameToFind}" en el menú. Omitido.`);
                    }
                    idx++;
                    setTimeout(doNext, 500);
                }, 300);
            }
            doNext();
        }

        //----------------------------------------------------------------------
        // Step 2: For each "Factura simplificada": open invoice tab, poll up to 15s for "Imprimir", click once, wait, then close.
        //----------------------------------------------------------------------
        function downloadSimplifiedInvoices(onDone) {
            console.log('[TM] Buscando "Factura simplificada"...');
            const elements = document.querySelectorAll('div, span, td, tr, li, section');
            const toOpen = {};
            elements.forEach(el => {
                if (el.textContent && el.textContent.includes('Factura simplificada')) {
                    const anchor = el.querySelector('a[href*="#/invoice/card?id"]');
                    if (anchor) {
                        let invoiceUrl = anchor.href;
                        if (!invoiceUrl.startsWith('http')) {
                            invoiceUrl = window.location.origin + anchor.getAttribute('href');
                        }
                        invoiceUrl = invoiceUrl.trim();
                        const m = invoiceUrl.match(/(idInvoice|idBookingInvoice)=([^&]+)/);
                        if (m && m[1] && m[2]) {
                            const key = m[1] + '-' + m[2];
                            if (!window.__processedInvoices.has(key)) {
                                toOpen[key] = invoiceUrl;
                            }
                        }
                    }
                }
            });
            const invoiceLinks = Object.values(toOpen);
            if (invoiceLinks.length === 0) {
                console.log('[TM] No hay facturas simplificadas nuevas o ya procesadas.');
                if (onDone) onDone();
                return;
            }
            console.log(`[TM] Facturas simplificadas encontradas: ${invoiceLinks.length}`, invoiceLinks);
            let i = 0;
            function openNext() {
                if (i >= invoiceLinks.length) {
                    console.log('[TM] Procesamiento de Facturas Simplificadas completado.');
                    if (onDone) onDone();
                    return;
                }
                const url = invoiceLinks[i++];
                console.log('[TM] Abriendo factura:', url);
                const m = url.match(/(idInvoice|idBookingInvoice)=([^&]+)/);
                if (m) {
                    window.__processedInvoices.add(m[1] + '-' + m[2]);
                }
                const invoiceTab = window.open(url, '_blank');
                if (!invoiceTab) {
                    alert('[TM] Pop-ups bloqueados. Permite ventanas emergentes.');
                    if (onDone) onDone();
                    return;
                }
                let attempts = 0;
                const maxAttempts = 30; // 15s total (30*500ms)
                let imprimirClicked = false;
                const pollInvoice = setInterval(() => {
                    attempts++;
                    try {
                        if (invoiceTab.document && invoiceTab.document.readyState === 'complete') {
                            // Look for a label whose normalized text includes "Imprimir"
                            const imprimirLabel = [...invoiceTab.document.querySelectorAll('label')]
                                .find(lbl => normalizeText(lbl.textContent).includes('Imprimir'));
                            if (imprimirLabel && !imprimirClicked) {
                                const btnImprimir = imprimirLabel.closest('button');
                                if (btnImprimir) {
                                    simulateClick(btnImprimir);
                                    console.log(`[TM] Clic en "Imprimir" => ${url}`);
                                } else {
                                    simulateClick(imprimirLabel);
                                    console.log(`[TM] (Fallback) Clic en "Imprimir" => ${url}`);
                                }
                                imprimirClicked = true;
                                clearInterval(pollInvoice);
                                // Wait 5 seconds to allow the download to trigger, then close the tab.
                                setTimeout(() => {
                                    invoiceTab.close();
                                    openNext();
                                }, 5000);
                            }
                        }
                    } catch (err) {
                        console.error('[TM] Error al procesar factura:', err);
                    }
                    if (attempts >= maxAttempts && !imprimirClicked) {
                        console.log(`[TM] Tiempo agotado buscando "Imprimir" en ${url}. Cerrando factura.`);
                        clearInterval(pollInvoice);
                        invoiceTab.close();
                        openNext();
                    }
                }, 500);
            }
            openNext();
        }

        //----------------------------------------------------------------------
        // Step 3: On main page, click "Ver Checkin" -> new checkin tab -> poll up to 10s for the "Informe" button via ok-button element, click it once, then close the checkin tab.
        //----------------------------------------------------------------------
        function downloadCheckinInforme() {
            console.log('[TM] Buscando "Ver Checkin" en la página principal...');
            const checkinBtn = [...document.querySelectorAll('button.fake-button.fake-button-default.button-form')]
                .find(b => normalizeText(b.textContent).includes('Ver Checkin'));
            if (!checkinBtn) {
                console.log('[TM] No se encontró el botón "Ver Checkin".');
                return;
            }
            let checkinTab = null;
            const oldOpen = window.open;
            window.open = function(...args) {
                checkinTab = oldOpen.apply(this, args);
                console.log('[TM] Checkin tab abierto:', args[0]);
                return checkinTab;
            };
            simulateClick(checkinBtn);
            console.log('[TM] Clic en "Ver Checkin".');
            let tries = 0;
            const maxTries = 20; // 10s total
            const pollCheckin = setInterval(() => {
                tries++;
                try {
                    if (checkinTab && checkinTab.document && checkinTab.document.readyState === 'complete') {
                        // Instead of looking for a label, look for the ok-button with text attribute "action.report"
                        const okBtn = checkinTab.document.querySelector('ok-button[text*="action.report"] button');
                        if (okBtn) {
                            simulateClick(okBtn);
                            console.log('[TM] Clic en "Informe" (via ok-button) => checkinTab');
                            clearInterval(pollCheckin);
                            setTimeout(() => {
                                checkinTab.close();
                                console.log('[TM] Checkin tab cerrado.');
                            }, 2000);
                        }
                    }
                } catch (err) {
                    console.error('[TM] Error al procesar checkinTab:', err);
                }
                if (tries >= maxTries) {
                    clearInterval(pollCheckin);
                    if (checkinTab) {
                        checkinTab.close();
                    }
                    console.log('[TM] Tiempo agotado buscando "Informe" en checkinTab. Cerrado.');
                }
            }, 500);
        }

        //----------------------------------------------------------------------
        // Main Click Handler: Execute steps in order.
        //----------------------------------------------------------------------
        btn.addEventListener('click', () => {
            console.log('[TM] Botón "Descargar Docu" pulsado.');
            downloadSmartSignDocs(() => {
                console.log('[TM] SmartSign completado. Iniciando Facturas Simplificadas...');
                downloadSimplifiedInvoices(() => {
                    console.log('[TM] Facturas Simplificadas completadas. Iniciando Ver Checkin -> Informe...');
                    downloadCheckinInforme();
                });
            });
        });
    }

    // Watch for SPA navigation changes.
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            if (isContractCardPage()) {
                addDownloadButton();
            }
        }
    }).observe(document, { childList: true, subtree: true });

    // Initial check.
    if (isContractCardPage()) {
        addDownloadButton();
    }
})();