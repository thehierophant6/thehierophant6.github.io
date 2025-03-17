// ==UserScript==
// @name         AutoOpenZendeskTicket
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Abre automáticamente el ticket de Zendesk al detectar número de referencia
// @include        https://okmobility.gocontact.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let ultimoValor = "";

    // Observamos todo el body, a la espera de que se inserte el nodo con el id "voice-field-field8"
    const observer = new MutationObserver(() => {
        const campoReferencia = document.getElementById('voice-field-field8');
        if (campoReferencia) {
            // Cuando lo encontremos, dejamos de observar (si queremos)
            observer.disconnect();

            // Añadimos listener
            campoReferencia.addEventListener('input', function() {
                const valorActual = this.value.trim();
                if (valorActual && valorActual !== ultimoValor) {
                    ultimoValor = valorActual;
                    window.open(`https://okmobility.zendesk.com/agent/tickets/${valorActual}`, '_blank');
                }
            });
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
