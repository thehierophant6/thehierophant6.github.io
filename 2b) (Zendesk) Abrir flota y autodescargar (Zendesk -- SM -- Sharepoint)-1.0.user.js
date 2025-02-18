// ==UserScript==
// @name         2b) (Zendesk) Abrir flota y autodescargar (Zendesk -> SM -> Sharepoint)
// @namespace    https://okmobility.zendesk.com
// @version      1.0
// @description  Adds a second button in Zendesk called "Descargar Fotos". It opens SmartMotion contract page, where "Abrir Flota" script runs.
// @match        https://okmobility.zendesk.com/agent/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    /************************************************************
     * HELPER FOR BUTTON PLACEMENT
     ************************************************************/
    function insertButtonInTicketFooter(button) {
        const footerContainer = document.querySelector('.sc-177ytgv-1.WxSHa');
        if (footerContainer) {
            button.style.marginLeft = '10px';
            footerContainer.appendChild(button);
        } else {
            setTimeout(() => { insertButtonInTicketFooter(button); }, 1000);
        }
    }

    let lastUrl = location.href;

    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            checkTicketPage();
        }
    }, 1000);

    // Inicializa al cargar
    checkTicketPage();

    function checkTicketPage() {
        const isTicketUrl = /\/agent\/tickets\/\d+/.test(location.href);
        const existingBtn = document.getElementById('zendesk-fotos-btn');

        if (isTicketUrl && !existingBtn) {
            createFotosButton();
        } else if (!isTicketUrl && existingBtn) {
            existingBtn.remove();
        }
    }

    // Crea e inserta el botón "Descargar Fotos"
    function createFotosButton() {
        const button = document.createElement('button');
        button.id = 'zendesk-fotos-btn';
        button.innerText = 'Descargar Fotos';

        button.style.padding = '10px 16px';
        button.style.backgroundColor = '#0052CC';
        button.style.color = '#fff';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '10000';

        insertButtonInTicketFooter(button);

        button.addEventListener('click', () => {
            const refField = document.querySelector(
                '[data-test-id="ticket-form-field-text-field-21818242478365"] input'
            );
            if (!refField || !refField.value.trim()) {
                alert('El campo "Web OK - Referencia" está vacío.');
                return;
            }

            // ******* THIS IS THE ONLY PART CHANGED *******
            // Split on "/" so we can handle multiple references.
            const refString = refField.value.trim();
            const refArray = refString.split('/').map(r => r.trim()).filter(Boolean);

            for (let i = 0; i < refArray.length; i++) {
                const ref = refArray[i];

                if (!/^\d{7}$/.test(ref)) {
                    alert('La referencia debe ser un número de 7 dígitos.');
                    return;
                }

                const num = parseInt(ref, 10);
                if (num < 3000000 || num > 6900000) {
                    alert('Para descargar fotos, la referencia debe ser contrato (3.000.000 - 6.900.000).');
                    return;
                }

                const url = `https://pro.smartmotion.es/#/contract/card/${ref}?fotos=1`;
                window.open(url, '_blank');
            }
            // ******* END OF CHANGE *******
        });

        console.log('[Zendesk -> Descargar Fotos] Button created.');
    }
})();


