// ==UserScript==
// @name         1b) (ZENDESK) Descarga de Contrato
// @namespace    https://okmobility.zendesk.com
// @version      1.0
// @description  Desde Zendesk, lee el campo "Web OK - Referencia" y descarga 3 archivos en SmartMotion (auto-download), luego cierra la pestaña
// @match        https://okmobility.zendesk.com/agent/*
// @match        https://pro.smartmotion.es/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    /************************************************************
     * HELPER FOR BUTTON PLACEMENT
     ************************************************************/
    // Inserta el botón dentro del contenedor de la barra de macros.
    // Se busca el contenedor derecho, identificado por la clase ".sc-177ytgv-1.WxSHa".
    function insertButtonInTicketFooter(button) {
        const footerContainer = document.querySelector('.sc-177ytgv-1.WxSHa');
        if (footerContainer) {
            // Agrega un pequeño margen para separar el botón de los demás.
            button.style.marginLeft = '10px';
            footerContainer.appendChild(button);
        } else {
            // Si no se encuentra, reintenta en 1 segundo.
            setTimeout(() => { insertButtonInTicketFooter(button); }, 1000);
        }
    }

    /************************************************************
     * CODE FOR ZENDESK DOMAIN
     ************************************************************/
    if (location.host.includes('okmobility.zendesk.com')) {

        let lastUrl = location.href;

        // Actualiza la visibilidad del botón según la URL (solo en páginas de ticket)
        function updateButtonVisibility() {
            const isTicketUrl = /\/agent\/tickets\/\d+/.test(location.href);
            const existingButton = document.getElementById('custom-smartmotion-download-btn');

            if (isTicketUrl && !existingButton) {
                createButton();
            } else if (!isTicketUrl && existingButton) {
                existingButton.remove();
            }
        }

        // Crea e inserta el botón "Descargar Documentación"
        function createButton() {
            const button = document.createElement('button');
            button.id = 'custom-smartmotion-download-btn';
            button.innerText = 'Descargar Documentación';

            // Estilos para integrarse en la barra de macros (sin posicionamiento fijo)
            button.style.padding = '10px 16px';
            button.style.backgroundColor = '#0052CC';
            button.style.color = '#fff';
            button.style.border = 'none';
            button.style.borderRadius = '4px';
            button.style.cursor = 'pointer';
            button.style.zIndex = '10000';

            // Inserta el botón en la barra de macros
            insertButtonInTicketFooter(button);

            // Al hacer clic, lee el campo "Web OK - Referencia" y abre la URL correspondiente en SmartMotion
            button.addEventListener('click', () => {
                const customField = document.querySelector(
                    '[data-test-id="ticket-form-field-text-field-21818242478365"] input'
                );
                if (!customField || !customField.value) {
                    alert('Web OK - Referencia field not found or empty!');
                    return;
                }

                const number = customField.value.trim();
                if (!number || !/^\d{7}$/.test(number)) {
                    alert('Invalid number format! Must be 7 digits.');
                    return;
                }

                if (number >= 7000000 && number <= 9999999) {
                    window.open(
                        `https://pro.smartmotion.es/#/booking/card/${number}?autoDownload=1`,
                        '_blank'
                    );
                } else if (number >= 3000000 && number <= 6900000) {
                    window.open(
                        `https://pro.smartmotion.es/#/contract/card/${number}?autoDownload=1`,
                        '_blank'
                    );
                } else {
                    alert('Number is not within the known contract/booking ranges!');
                }
            });

            console.log('SM Download Button added successfully.');
        }

        // Detecta cambios de URL (comportamiento SPA)
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                updateButtonVisibility();
            }
        }, 1000);

        // Inicializa en la primera carga
        updateButtonVisibility();
    }

    /************************************************************
     * CODE FOR SMARTMOTION DOMAIN (SIN CAMBIOS EN PLACEMENT)
     ************************************************************/
    else if (location.host.includes('pro.smartmotion.es')) {

        const DOWNLOAD_LABELS = [
            'Descargar de Smart Sign',
            'Descargar condiciones',
            'Descargar desistimiento'
        ];

        let hasAutoDownloaded = false;

        function simulateClick(element) {
            if (!element) return;
            var evt = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            element.dispatchEvent(evt);
        }

        function startDownloadSequence() {
            let downloadIndex = 0;

            function downloadNext() {
                if (downloadIndex >= DOWNLOAD_LABELS.length) {
                    setTimeout(() => { window.close(); }, 500);
                    return;
                }

                var menuButton = document.querySelector('.ui-splitbutton-menubutton');
                if (!menuButton) {
                    alert('No se ha encontrado el botón de menú (ui-splitbutton-menubutton).');
                    return;
                }

                simulateClick(menuButton);

                setTimeout(function() {
                    var items = document.querySelectorAll('.ui-menuitem-text');
                    var found = false;
                    items.forEach(function(item) {
                        if (item.textContent.trim() === DOWNLOAD_LABELS[downloadIndex]) {
                            var anchor = item.closest('a');
                            if (anchor) {
                                simulateClick(anchor);
                                found = true;
                                downloadIndex++;
                                setTimeout(downloadNext, 1000);
                            }
                        }
                    });

                    if (!found) {
                        alert('Download button "' + DOWNLOAD_LABELS[downloadIndex] + '" not found.');
                    }
                }, 500);
            }
            downloadNext();
        }

        function isSmartMotionCardPage() {
            return (
                location.href.includes('/#/contract/card/') ||
                location.href.includes('/#/booking/card/')
            );
        }

        function addDownloadButton() {
            if (document.getElementById('downloadAllFilesButton')) return;

            var downloadButton = document.createElement('button');
            downloadButton.id = 'downloadAllFilesButton';
            downloadButton.innerText = 'Download All Files';
            downloadButton.style.position = 'fixed';
            downloadButton.style.top = '10px';
            downloadButton.style.right = '10px';
            downloadButton.style.zIndex = 1000;
            downloadButton.style.padding = '10px';
            downloadButton.style.backgroundColor = '#007bff';
            downloadButton.style.color = '#fff';
            downloadButton.style.border = 'none';
            downloadButton.style.borderRadius = '5px';
            downloadButton.style.cursor = 'pointer';

            downloadButton.addEventListener('click', function() {
                startDownloadSequence();
            });

            document.body.appendChild(downloadButton);
        }

        function onSmartMotionPageChange() {
            if (!isSmartMotionCardPage()) return;

            addDownloadButton();

            const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
            const autoDownloadFlag = urlParams.get('autoDownload');

            if (autoDownloadFlag === '1' && !hasAutoDownloaded) {
                hasAutoDownloaded = true;
                setTimeout(() => { startDownloadSequence(); }, 1000);
            }
        }

        let lastHref = location.href;
        new MutationObserver(() => {
            const currentHref = location.href;
            if (currentHref !== lastHref) {
                lastHref = currentHref;
                onSmartMotionPageChange();
            }
        }).observe(document, {childList: true, subtree: true});

        onSmartMotionPageChange();
    }
})();

