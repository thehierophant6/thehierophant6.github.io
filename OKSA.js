// ==UserScript==
// @name         OK Smart Audit (TM)
// @namespace    okm
// @version      1.3.0
// @description  Track top-page activity + stable state; Zendesk claim; no iframes
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net
// ==/UserScript==

(async function () {
  // ---- guard: Tampermonkey APIs ----
  const hasGM = typeof GM !== 'undefined'
             && typeof GM.xmlHttpRequest === 'function'
             && typeof GM.getValue === 'function'
             && typeof GM.setValue === 'function';
  if (!hasGM) { console.error("[OKSA] GM APIs no disponibles (¿Tampermonkey desactivado?)."); return; }

  // ========= CONFIG =========
  const API           = "https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api";
  const HEARTBEAT_MS  = 30_000;   // hb cada 30s
  const CLAIM_MS      = 180_000;  // claim cada 3 min (sólo Zendesk)
  const IDLE_MS       = 30_000;  // inactivo tras 30s sin interacción
  const STABLE_MS     = 2_000;    // el nuevo estado debe mantenerse 2s
  const DEBUG         = true;

  const log  = (...a) => DEBUG && console.log("[OKSA]", ...a);
  const warn = (...a) => DEBUG && console.warn("[OKSA]", ...a);
  const err  = (...a) => console.error("[OKSA]", ...a);

  // ========= HTTP =========
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

  // ========= IDs =========
  async function getDSID() {
    let id = await GM.getValue("device_session_id");
    if (!id) {
      id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      await GM.setValue("device_session_id", id);
      log("Nuevo device_session_id:", id);
    }
    return id;
  }

  function getSegmentId() {
    let sid = sessionStorage.getItem("oksa_segment_id");
    if (!sid) {
      sid = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      sessionStorage.setItem("oksa_segment_id", sid);
    }
    return sid;
  }

  const dsid = await getDSID();
  const segmentId = getSegmentId();

  // ========= Zendesk helpers =========
  const isZendesk = () => /\.zendesk\.com$/.test(location.hostname);
  function getZendeskUserId() {
    if (!isZendesk()) return null;

    // Method 1: Traditional meta tag
    let m = document.querySelector('meta[name="current-user-id"]');
    if (m?.content) {
      const n = parseInt(m.content, 10);
      if (Number.isFinite(n)) return n;
    }

    // Method 2: Alternative meta tag names
    const metaVariants = ['user-id', 'current_user_id', 'zendesk-user-id', 'user_id'];
    for (const variant of metaVariants) {
      m = document.querySelector(`meta[name="${variant}"]`);
      if (m?.content) {
        const n = parseInt(m.content, 10);
        if (Number.isFinite(n)) return n;
      }
    }

    // Method 3: Search in window object for user data
    try {
      if (window.ZAF && window.ZAF.context && window.ZAF.context.account) {
        const userInfo = window.ZAF.context.account;
        if (userInfo.currentUser && userInfo.currentUser.id) {
          const n = parseInt(userInfo.currentUser.id, 10);
          if (Number.isFinite(n)) return n;
        }
      }
    } catch (e) { /* ignore */ }

    // Method 4: Search in page content for user ID patterns
    try {
      const bodyText = document.body.innerHTML;
      // Look for ResponsablesCC user ID specifically
      if (bodyText.includes('ResponsablesCC') || bodyText.includes('7838939114525')) {
        return 7838939114525;
      }

      // Look for user ID in common patterns
      const patterns = [
        /"current_user":\s*{\s*"id":\s*(\d+)/,
        /"user_id":\s*(\d+)/,
        /currentUser.*?id['":\s]*(\d+)/,
        /"id":\s*(\d+).*"email":/
      ];

      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match) {
          const n = parseInt(match[1], 10);
          if (Number.isFinite(n) && n > 1000000) return n; // Zendesk IDs are large
        }
      }
    } catch (e) { /* ignore */ }

    log("⚠️ Could not detect Zendesk user ID");
    return null;
  }
  function getZendeskTicketId() {
    if (!isZendesk()) return null;
    const m = location.pathname.match(/\/agent\/tickets\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ========= Activity & State =========
  let lastInteractionAt = Date.now();
  const bumpInteraction = () => { lastInteractionAt = Date.now(); };

  ["mousemove","mousedown","keydown","wheel","touchstart","scroll","click"].forEach(evt =>
    window.addEventListener(evt, bumpInteraction, { passive: true })
  );

  const isIdle = () => (Date.now() - lastInteractionAt) > IDLE_MS;

  // Estado estable con histéresis (no usamos focus/blur para evitar “humanidad” falsa)
  // Reglas:
  // - BG si document.hidden === true
  // - si no está oculta: ID si idle; AC si Zendesk; si no, WEB
  function computeState() {
    if (document.hidden) return "BG";
    if (isIdle())       return "ID";
    if (isZendesk())    return "AC";
    return "WEB";
  }

  let lastSentState = null;
  let pendingState = null;
  let pendingTimer = null;

  function emitState(state, kind) {
    lastSentState = state;
    const payload = basePayload(kind, state);
    gmPost(`${API}/activity`, payload, `activity ${kind}/${state}`);
  }

  function scheduleStableState() {
    const s = computeState();
    if (s === lastSentState || s === pendingState) return;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingState = s;
    pendingTimer = setTimeout(() => {
      const now = computeState();
      if (now === pendingState && now !== lastSentState) {
        emitState(now, "state");
      }
      pendingState = null;
      pendingTimer  = null;
    }, STABLE_MS);
  }

  // Cambios que pueden alterar el estado
  document.addEventListener("visibilitychange", scheduleStableState);
  // Aunque no usamos focus/blur para decidir BG, pueden acelerar la detección de actividad
  window.addEventListener("focus", () => { bumpInteraction(); scheduleStableState(); }, true);
  window.addEventListener("blur",  () => { scheduleStableState(); }, true);

  // ========= Payloads =========
  function basePayload(kind, state) {
    const p = {
      kind, state,
      device_session_id: dsid,
      segment_id: segmentId,
      domain: location.hostname,     // sólo top-page gracias a @noframes
      url: location.href,
      meta: {
        title: document.title || null,
        lang: document.documentElement.lang || navigator.language || null,
        referrer: document.referrer || null
      }
    };
    const tid = getZendeskTicketId();
    if (tid) p.ticket_id = tid;
    return p;
  }

  // ========= Claim en Zendesk =========
  function renewClaim() {
    const uid = getZendeskUserId();
    log(`🔍 Attempting claim - User ID: ${uid}, DSID: ${dsid}`);
    if (!uid) {
      log("❌ No user ID found, skipping claim");
      return;
    }
    const body = { device_session_id: dsid, user_id: uid, ttl_minutes: 480 };
    log(`📤 Sending claim:`, body);
    gmPost(`${API}/claim`, body, "claim");
  }

  // ========= Boot =========
  // Estado inicial inmediato para “anclar” la pestaña
  emitState(computeState(), "state");

  // Heartbeat periódico (se envía el estado recalculado en cada hb)
  setInterval(() => emitState(computeState(), "hb"), HEARTBEAT_MS);

  // Programar cambios estables ante interacción / visibilidad
  scheduleStableState();

  // Claim periódico en Zendesk
  if (isZendesk()) {
    log("🏢 Detected Zendesk, initializing claims...");
    renewClaim(); // Claim inmediato
    setInterval(renewClaim, CLAIM_MS); // Claim periódico

    // También hacer claim cuando cambia la URL (navegación en Zendesk)
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log("🔄 URL changed in Zendesk, making claim...");
        setTimeout(renewClaim, 1000); // Esperar un poco para que la página se cargue
      }
    }, 2000);
  }

  // Aviso al salir
  window.addEventListener("pagehide", () => {
    try { emitState(computeState(), "pagehide"); } catch {}
  }, { capture: true });
})();
