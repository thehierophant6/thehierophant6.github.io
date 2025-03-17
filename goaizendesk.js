// ==UserScript==
// @name         AutoClickZendeskOpen
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hace clic automáticamente en el botón "Open" de Zendesk
// @match        https://okmobility.gocontact.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    console.log("AutoClickZendeskOpen cargado...");

    let ultimoHref = "";

    // Cada 2s buscamos el enlace
    setInterval(() => {
        // Seleccionamos el <a> con clase .btn.btn-primary cuyo href apunte a tickets de Zendesk:
        // Ajusta este selector si hay más botones .btn-primary en la página
        const linkOpen = document.querySelector('a.btn.btn-primary[href*="okmobility.zendesk.com/agent/tickets/"]');

        if (linkOpen) {
            const hrefActual = linkOpen.getAttribute('href');
            // Para no hacer click infinitamente en el mismo href, comprobamos si cambia
            if (hrefActual && hrefActual !== ultimoHref) {
                ultimoHref = hrefActual;
                console.log("Clic automático en 'Open' =>", hrefActual);
                linkOpen.click();
            }
        }
    }, 2000); // verifica cada 2 segundos
})();
