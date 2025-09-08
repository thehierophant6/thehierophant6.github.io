// ==UserScript==
// @name         OK Smart Audit
// @namespace    okm
// @match        *://*/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// @connect      oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net
// ==/UserScript==

(async function () {
  const API = "https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api";

  async function getDSID() {
    let id = await GM.getValue("device_session_id");
    if (!id) {
      id = (self.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random()));
      await GM.setValue("device_session_id", id);
      console.log("[OKSA] Nuevo device_session_id:", id);
    }
    return id;
  }
  const dsid = await getDSID();

  function getZendeskUserId() {
    if (!/\.zendesk\.com$/.test(location.hostname)) return null;
    const m = document.querySelector('meta[name="current-user-id"]');
    return m?.content ? parseInt(m.content, 10) : null;
  }

  function gmPost(url, data, tag) {
    GM.xmlHttpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(data),
      timeout: 8000,
      onload: (res) => {
        const ok = res.status >= 200 && res.status < 300;
        console.log(`[OKSA] ${tag} →`, res.status, res.responseText || "");
      },
      onerror: (err) => {
        console.error(`[OKSA] ${tag} ERROR`, err);
      },
      ontimeout: () => {
        console.warn(`[OKSA] ${tag} TIMEOUT`);
      }
    });
  }

  function send(kind, state) {
    const payload = {
      kind, state,
      device_session_id: dsid,
      domain: location.hostname,
      url: location.href
    };
    gmPost(`${API}/activity`, payload, `activity ${kind}/${state}`);
  }

  async function renewClaim() {
    const uid = getZendeskUserId();
    if (!uid) return;
    gmPost(`${API}/claim`, { device_session_id: dsid, user_id: uid, ttl_minutes: 480 }, "claim");
  }

  // Primer estado + heartbeat recurrente
  send("state", document.hasFocus() ? "WEB" : "BG");
  setInterval(() => send("hb", document.hasFocus() ? "WEB" : "BG"), 30000);
  window.addEventListener("visibilitychange", () => send("state", document.hidden ? "BG" : "WEB"));

  // Reclamo periódico sólo en Zendesk
  if (/\.zendesk\.com$/.test(location.hostname)) {
    renewClaim();
    setInterval(renewClaim, 180000);
  }
})();
