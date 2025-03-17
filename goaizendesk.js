// ==UserScript==
// @name         AutoOpenZendeskTicket
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Abre automáticamente el ticket de Zendesk al detectar número de referencia
// @match        https://okmobility.gocontact.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let ultimoValor = "";

    // Revisamos cada X tiempo si el campo existe y si su valor cambió
    setInterval(() => {
        const campoReferencia = document.getElementById('voice-field-field8');
        if (campoReferencia) {
            const valorActual = campoReferencia.value.trim();

            // Sólo abrimos si el valor no está vacío y es distinto al último
            if (valorActual && valorActual !== ultimoValor) {
                ultimoValor = valorActual;
                window.open(`https://okmobility.zendesk.com/agent/tickets/${valorActual}`, '_blank');
            }
        }
    }, 1000); // cada 1 segundo
})();
