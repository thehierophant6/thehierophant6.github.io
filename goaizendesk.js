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

    // Para evitar que se abra repetidamente por el mismo número
    let ultimoValor = "";

    // Localiza el campo por su id
    const campoReferencia = document.getElementById('voice-field-field8');
    if (!campoReferencia) return; // Si no existe, no hace nada

    // Opción 1: usar "input" event para detectar cambios en tiempo real
    campoReferencia.addEventListener('input', function() {
        const valorActual = campoReferencia.value.trim();
        // Si tiene valor y es distinto al último que abrimos, abrimos la URL
        if (valorActual && valorActual !== ultimoValor) {
            ultimoValor = valorActual;
            window.open('https://okmobility.zendesk.com/agent/tickets/' + valorActual, '_blank');
        }
    });

    // Opción 2 (alternativa): un setInterval que revisa el campo cada cierto tiempo
    /*
    setInterval(() => {
        const valorActual = campoReferencia.value.trim();
        if (valorActual && valorActual !== ultimoValor) {
            ultimoValor = valorActual;
            window.open('https://okmobility.zendesk.com/agent/tickets/' + valorActual, '_blank');
        }
    }, 1000);
    */
})();
