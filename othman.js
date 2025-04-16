// ==UserScript==
// @name         Zendesk - Bloqueo de correos prohibidos (TO, CC, BCC)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Evita enviar tickets a direcciones bloqueadas desde Zendesk, incluyendo TO, CC y BCC
// @author       Carlos
// @match        https://*.zendesk.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const correosBloqueados = [
        "carlosjsp94@gmail.com",
        "ejemplo@prohibido.com",
        "test@noenviar.com"
    ];

    function normalizar(correo) {
        return correo.trim().toLowerCase();
    }

    function obtenerCamposCorreo() {
        const campos = [];

        // TO
        const to = document.querySelector('[data-test-id="composer:recipient-email"] input');
        if (to) campos.push(to);

        // CC y BCC
        const ccInputs = document.querySelectorAll('[data-test-id="composer:cc"] input');
        const bccInputs = document.querySelectorAll('[data-test-id="composer:bcc"] input');

        ccInputs.forEach(input => campos.push(input));
        bccInputs.forEach(input => campos.push(input));

        return campos;
    }

    function verificarBloqueo() {
        const inputs = obtenerCamposCorreo();
        const enviarBtn = document.querySelector('[data-test-id="composer:submit-button"]');
        const advertenciaYaExiste = document.getElementById('alerta-correo-bloqueado');

        const correosEncontrados = inputs
            .map(input => normalizar(input.value))
            .filter(val => val && correosBloqueados.includes(val));

        if (correosEncontrados.length > 0) {
            // Bloquear envío
            if (enviarBtn) enviarBtn.disabled = true;

            // Mostrar advertencia visual si no existe
            if (!advertenciaYaExiste) {
                const advertencia = document.createElement("div");
                advertencia.id = "alerta-correo-bloqueado";
                advertencia.textContent = `¡Dirección bloqueada detectada! No se puede enviar este ticket.`;
                advertencia.style.background = "#ffcccc";
                advertencia.style.color = "#900";
                advertencia.style.padding = "10px";
                advertencia.style.margin = "10px 0";
                advertencia.style.border = "2px solid red";
                advertencia.style.fontWeight = "bold";
                document.querySelector('[data-test-id="composer:composer-form"]')?.prepend(advertencia);
            }

            // Borrar campos bloqueados
            inputs.forEach(input => {
                if (correosBloqueados.includes(normalizar(input.value))) {
                    input.value = "";
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });

            alert(`Las siguientes direcciones están bloqueadas: \n${correosEncontrados.join(", ")}`);
        } else {
            if (enviarBtn) enviarBtn.disabled = false;
            if (advertenciaYaExiste) advertenciaYaExiste.remove();
        }
    }

    // Observador de cambios
    const observer = new MutationObserver(() => {
        verificarBloqueo();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Revisión periódica por si el observador no detecta
    setInterval(verificarBloqueo, 1500);
})();
