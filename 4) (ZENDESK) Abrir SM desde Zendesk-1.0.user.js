// ==UserScript==
// @name         4) (ZENDESK) Abrir SM desde Zendesk
// @namespace    https://okmobility.zendesk.com
// @version      1.0
// @description  Adds a button to redirect based on the "Web OK - Referencia" field
// @match        https://okmobility.zendesk.com/agent/*
// @grant        none
// ==/UserScript==

(function () {
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

    // Actualiza la visibilidad del botón según la URL (solo en páginas de ticket)
    function updateButtonVisibility() {
        const isTicketUrl = /\/agent\/tickets\/\d+/.test(location.href);
        const existingButton = document.getElementById('custom-smartmotion-btn');

        if (isTicketUrl && !existingButton) {
            createButton();
        } else if (!isTicketUrl && existingButton) {
            existingButton.remove();
        }
    }

    // Crea e inserta el botón "Ir a SM"
    function createButton() {
        const button = document.createElement('button');
        button.id = 'custom-smartmotion-btn';
        button.innerText = 'Ir a SM';

        button.style.padding = '10px 16px';
        button.style.backgroundColor = '#0052CC';
        button.style.color = '#fff';
        button.style.border = 'none';
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.zIndex = '10000';

        insertButtonInTicketFooter(button);

        button.addEventListener('click', () => {
            const customField = document.querySelector(
                '[data-test-id="ticket-form-field-text-field-21818242478365"] input'
            );
            if (!customField || !customField.value) {
                alert('Web OK - Referencia field not found or empty!');
                return;
            }

            const number = customField.value.trim();
            if (number && /^\d{7}$/.test(number)) {
                if (number >= 7000000 && number <= 9999999) {
                    window.open(`https://pro.smartmotion.es/#/booking/card/${number}`, '_blank');
                } else if (number >= 3000000 && number <= 6900000) {
                    window.open(`https://pro.smartmotion.es/#/contract/card/${number}`, '_blank');
                } else {
                    alert('Number is not within valid ranges!');
                }
            } else {
                alert('Invalid number format!');
            }
        });

        console.log('Button added successfully.');
    }

    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            updateButtonVisibility();
        }
    }, 1000);

    updateButtonVisibility();
})();
