// ==UserScript==
// @name         OK Smart Audit
// @namespace    okm
// @match        *://*/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// ==/UserScript==

(async function () {
  const API = "https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api"

  async function getDSID() {
    let id = await GM.getValue("device_session_id");
    if (!id) {
      id = (self.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random()));
      await GM.setValue("device_session_id", id);
    }
    return id;
  }
  const dsid = await getDSID();

  function getZendeskUserId() {
    if (!/\.zendesk\.com$/.test(location.hostname)) return null;
    const m = document.querySelector('meta[name="current-user-id"]');
    return m?.content ? parseInt(m.content, 10) : null;
  }

  async function renewClaim() {
    const uid = getZendeskUserId();
    if (!uid) return;
    GM.xmlHttpRequest({
      method: "POST",
      url: `${API}/claim`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ device_session_id: dsid, user_id: uid, ttl_minutes: 480 }),
      timeout: 8000
    });
  }
  if (/\.zendesk\.com$/.test(location.hostname)) {
    renewClaim();
    setInterval(renewClaim, 180000);
  }

  function send(kind, state) {
    const payload = {
      kind, state,
      device_session_id: dsid,
      domain: location.hostname,
      url: location.href
    };
    GM.xmlHttpRequest({
      method: "POST",
      url: `${API}/activity`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload)
    });
  }

  send("state", document.hasFocus() ? "WEB" : "BG");
  setInterval(() => send("hb", document.hasFocus() ? "WEB" : "BG"), 30000);
  window.addEventListener("visibilitychange", () => send("state", document.hidden ? "BG" : "WEB"));
})();
