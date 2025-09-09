// ==UserScript==
// @name         OK Smart Audit
// @namespace    okm
// @description  Track activity pings + live attribution via device_session_id, with Zendesk claim
// @match        *://*/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// @connect      oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net
// ==/UserScript==

(async function () {
  // ========= CONFIG =========
  const API = "https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api"; // <-- tu Function URL (sin www)
  const HEARTBEAT_MS = 30_000;
  const CLAIM_MS     = 180_000;
  const IDLE_MS      = 120_000;
  const DEBUG        = true; // pon false para silenciar logs

  // ========= HELPERS =========
  const log  = (...a) => DEBUG && console.log("[OKSA]", ...a);
  const warn = (...a) => DEBUG && console.warn("[OKSA]", ...a);
  const err  = (...a) => console.error("[OKSA]", ...a);

  function gmPost(url, data, tag) {
    GM.xmlHttpRequest({
      method: "POST",
      url,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(data),
      timeout: 12_000,
      onload: (res) => {
        const ok = res.status >= 200 && res.status < 300;
        log(`${tag} →`, res.status, ok ? "" : (res.responseText || ""));
      },
      onerror: (e) => err(`${tag} ERROR`, e),
      ontimeout: () => warn(`${tag} TIMEOUT`)
    });
  }

  async function getDSID() {
    let id = await GM.getValue("device_session_id");
    if (!id) {
      id = (self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      await GM.setValue("device_session_id", id);
      log("Nuevo device_session_id:", id);
    }
    return id;
  }

  function getSegmentId() {
    let sid = sessionStorage.getItem("oksa_segment_id");
    if (!sid) {
      sid = (self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      sessionStorage.setItem("oksa_segment_id", sid);
    }
    return sid;
  }

  function isZendeskHost() {
    return /\.zendesk\.com$/.test(location.hostname);
  }

  function getZendeskUserId() {
    if (!isZendeskHost()) return null;
    // Zendesk suele exponerlo en una meta
    const m = document.querySelector('meta[name="current-user-id"]');
    if (m?.content) {
      const n = parseInt(m.content, 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function getZendeskTicketId() {
    if (!isZendeskHost()) return null;
    // /agent/tickets/<id>
    const m = location.pathname.match(/\/agent\/tickets\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
    // Si el patrón cambia, amplía aquí.
  }

  // ========= STATE ENGINE =========
  let lastInteractionAt = Date.now();
  let isFocused = document.hasFocus();
  let isHidden  = document.hidden;

  function bumpInteraction() { lastInteractionAt = Date.now(); }
  ["mousemove","mousedown","keydown","wheel","touchstart","scroll","click"].forEach(evt =>
    window.addEventListener(evt, bumpInteraction, { passive: true })
  );

  window.addEventListener("focus", () => { isFocused = true;  sendStateIfChanged(); }, true);
  window.addEventListener("blur",  () => { isFocused = false; sendStateIfChanged(); }, true);
  document.addEventListener("visibilitychange", () => { isHidden = document.hidden; sendStateIfChanged(); });

  function isIdle() { return (Date.now() - lastInteractionAt) > IDLE_MS; }

  function computeState() {
    if (isHidden || !isFocused) return "BG";              // Background
    if (isIdle()) return "ID";                            // Idle
    if (isZendeskHost()) return "AC";                     // Agent Console (Zendesk) en foco
    return "WEB";                                         // Web activa
  }

  let lastState = null;
  function sendStateIfChanged() {
    const s = computeState();
    if (s !== lastState) {
      lastState = s;
      send("state", s);
    }
  }

  // ========= PING SENDERS =========
  const dsid = await getDSID();
  const segmentId = getSegmentId();

  function basePayload(kind, state) {
    const payload = {
      kind,                         // 'hb' | 'state' | 'pagehide'
      state,                        // 'WEB' | 'AC' | 'ID' | 'BG'
      device_session_id: dsid,
      segment_id: segmentId,
      domain: location.hostname,
      url: location.href
    };

    // Adjunta ticket_id en Zendesk si está presente
    const tid = getZendeskTicketId();
    if (tid) payload.ticket_id = tid;

    // Metadatos útiles (opcionales)
    payload.meta = {
      title: document.title || null,
      lang: document.documentElement.lang || navigator.language || null,
      referrer: document.referrer || null
    };

    return payload;
  }

  function send(kind, state) {
    const payload = basePayload(kind, state);
    gmPost(`${API}/activity`, payload, `activity ${kind}/${state}`);
  }

  function renewClaim() {
    const uid = getZendeskUserId();
    if (!uid) return;
    const body = { device_session_id: dsid, user_id: uid, ttl_minutes: 480 };
    gmPost(`${API}/claim`, body, "claim");
  }

  // ========= BOOT =========
  // Estado inicial
  send("state", computeState());

  // Heartbeat
  setInterval(() => {
    send("hb", computeState());
  }, HEARTBEAT_MS);

  // Cambios de estado
  sendStateIfChanged();

  // Reclamo periódico si estamos en Zendesk
  if (isZendeskHost()) {
    renewClaim();
    setInterval(renewClaim, CLAIM_MS);
  }

  // Al cerrar / navegar fuera, intenta avisar
  window.addEventListener("pagehide", () => {
    try { send("pagehide", computeState()); } catch {}
  }, { capture: true });

})();
