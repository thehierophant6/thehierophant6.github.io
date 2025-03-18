// ==UserScript==
// @name         OKMobility - Abrir Zendesk por Referencia
// @namespace    https://okmobility.gocontact.com/
// @version      1.0
// @description  Abre automáticamente la URL de Zendesk con la referencia en otra pestaña cuando cambia el "Número referencia".
// @author       TuNombre
// @match        https://okmobility.gocontact.com/index.php#/voice*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Variable para guardar la última referencia que abrimos
    let ultimaReferencia = null;

    // Función que abrirá la URL en otra pestaña si la referencia es distinta
    function abrirZendeskSiCambia(nuevaRef) {
        if (nuevaRef && nuevaRef !== ultimaReferencia) {
            ultimaReferencia = nuevaRef;
            const url = `https://okmobility.zendesk.com/agent/tickets/${nuevaRef}`;
            window.open(url, '_blank');
        }
    }

    // Observamos cambios en el DOM, por si el campo con id="voice-field-field8" tarda en cargar o cambia dinámicamente
    const observer = new MutationObserver(() => {
        const inputReferencia = document.querySelector('#voice-field-field8');
        if (inputReferencia) {
            // En cuanto lo encontremos, dejamos de observar el DOM para evitar sobrecarga
            observer.disconnect();

            // Cada vez que el usuario cambie el valor (o sea cambiado dinámicamente), abrimos la URL
            inputReferencia.addEventListener('input', () => {
                const valorActual = inputReferencia.value.trim();
                abrirZendeskSiCambia(valorActual);
            });

            // Por si ya hay un valor cargado desde el principio
            const valorInicial = inputReferencia.value.trim();
            abrirZendeskSiCambia(valorInicial);
        }
    });

    // Iniciamos el observer en el body
    observer.observe(document.body, { childList: true, subtree: true });
})();
