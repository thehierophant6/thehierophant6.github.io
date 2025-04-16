// ==UserScript==
// @name         Zendesk - Bloqueo de correos prohibidos (versión robusta TO + CC)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Bloquea el envío en Zendesk si se detectan correos prohibidos en destinatarios (TO, CC, BCC visuales tipo chip/badge)
// @author       Carlos
// @match        https://*.zendesk.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const correosBloqueados = [
        "carlosjsp94@gmail.com",
        "test@prohibido.com"
    ];

    function normalizarCorreo(correo) {
        return correo.trim().toLowerCase();
    }

    function obtenerCorreosVisibles() {
        const chips = document.querySelectorAll('[data-test-id^="composer:recipient-pill"]'); // TO, CC, BCC pills
        const correosDetectados = [];

        chips.forEach(chip => {
            const texto = chip.textContent;
            if (texto && texto.includes("<") && texto.includes(">")) {
                const match = texto.match(/<(.*?)>/);
                if (match && match[1]) {
                    correosDetectados.push(normalizarCorreo(match[1]));
                }
            }
        });

        return correosDetectados;
    }

    function bloquearSiCorresponde() {
        const encontrados = obtenerCorreosVisibles();
        const prohibidos = encontrados.filter(c => correosBloqueados.includes(c));

        const submitBtn = document.querySelector('[data-test-id^="footer:submit-button"]'); // "Submit as Open", etc.
        const advertencia = document.getElementById("alerta-bloqueo");

        if (prohibidos.length > 0) {
            if (submitBtn) submitBtn.disabled = true;

            if (!advertencia) {
                const aviso = document.createElement("div");
                aviso.id = "alerta-bloqueo";
                aviso.innerText = `❌ No puedes enviar este ticket: destinatarios prohibidos detectados: ${prohibidos.join(", ")}`;
                aviso.style.background = "#ffcccc";
                aviso.style.color = "#900";
                aviso.style.padding = "10px";
                aviso.style.margin = "10px 0";
                aviso.style.border = "2px solid red";
                aviso.style.fontWeight = "bold";
                aviso.style.fontSize = "14px";

                const composerForm = document.querySelector('[data-test-id="composer:composer-form"]');
                if (composerForm) composerForm.prepend(aviso);
            }

            console.warn("Correos bloqueados detectados en Zendesk:", prohibidos);
        } else {
            if (submitBtn) submitBtn.disabled = false;
            if (advertencia) advertencia.remove();
        }
    }

    // Observador de cambios dinámicos
    const observer = new MutationObserver(() => bloquearSiCorresponde());
    observer.observe(document.body, { childList: true, subtree: true });

    // Revisión extra cada 1.5s por seguridad
    setInterval(bloquearSiCorresponde, 1500);
})();
