// ==UserScript==
// @name         OK Smart Audit
// @namespace    https://okmobility.com/
// @version      1.0.3
// @description  Activity tracker for Zendesk agents (focus/idle robusto + state-change pings)
// @author       OK Mobility
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log('[OK Smart Audit]', ...a); };

  // Config
  const CONFIG = {
    BACKEND_URL: 'https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api',
    HEARTBEAT_MS: 30000,         // latido base
    JITTER_MS: 2000,             // ±2s
    IDLE_MS: 60000,              // 60s → idle
    REF_TICKET_TTL_MS: 7 * 60 * 1000,
    ZD_HOST_REGEX: /\.zendesk\.com$/,
    STORAGE_PREFIX: 'ok_smart_audit_',
    STATE_MIN_INTERVAL_MS: 1500  // anti-flood entre pings de cambio de estado
  };

  // Estado
  const state = {
    jwt: null,
    userId: null,
    jwtExpiry: 0,
    lastActivity: Date.now(),
    lastTicketId: null,
    lastTicketExpiry: 0,
    tabId: genTabId(),
    isVisible: true,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
    isZendesk: false,
    hbTimer: null,
    idleTimer: null,
    lastSentState: null,
    lastStateEmitAt: 0
  };

  // Utils
  function genTabId() { return 'tab_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now(); }
  function jitter(ms) { return Math.max(1000, ms + (Math.random() - 0.5) * 2 * CONFIG.JITTER_MS); }
  function isZendesk() { return CONFIG.ZD_HOST_REGEX.test(location.hostname); }
  function lsKey(k) { return CONFIG.STORAGE_PREFIX + k; }
  function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch {} }
  function lsGet(k, d=null) { try { const s = localStorage.getItem(lsKey(k)); return s ? JSON.parse(s) : d; } catch { return d; } }
  function lsDel(k) { try { localStorage.removeItem(lsKey(k)); } catch {} }

  // Ticket helpers
  function extractTicketId() { const m = location.pathname.match(/\/agent\/tickets\/(\d+)/); return m ? parseInt(m[1], 10) : null; }
  function updateTicketRef() {
    const tid = extractTicketId();
    if (tid && tid !== state.lastTicketId) {
      state.lastTicketId = tid;
      state.lastTicketExpiry = Date.now() + CONFIG.REF_TICKET_TTL_MS;
      log('ticket ref', tid);
      emitStateIfChanged(true); // corta segmento ZTK a ticket correcto ASAP
    }
  }
  function currentTicketId() { return (state.lastTicketId && Date.now() < state.lastTicketExpiry) ? state.lastTicketId : null; }

  // Estado lógico actual
  function getCurrentState() {
    const idle = (Date.now() - state.lastActivity) >= CONFIG.IDLE_MS;
    if (!state.isVisible || !state.hasFocus) return 'BG';                    // pestaña oculta o sin foco
    if (state.isZendesk) return idle ? 'IDLE_ZENDESK' : 'ZTK';               // foco + Zendesk
    return idle ? 'IDLE_WEB' : 'WEB_ACTIVA';                                 // foco + otra web
  }

  // AUTENTICACIÓN
  function loadAuth() {
    const jwt = lsGet('jwt', null);
    const exp = lsGet('jwtExpiry', 0);
    const uid = lsGet('userId', null);
    if (jwt && exp && Date.now() < exp) {
      state.jwt = jwt; state.jwtExpiry = exp; state.userId = uid;
      log('auth loaded', { userId: uid });
      return true;
    }
    lsDel('jwt'); lsDel('jwtExpiry'); lsDel('userId');
    return false;
  }

  async function bootstrapAuth() {
    if (!isZendesk()) return false;
    try {
      // Check if we're in a valid Zendesk session
      const r = await fetch('/api/v2/users/me.json', { 
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (!r.ok) {
        log('zendesk me api failed', r.status);
        return false;
      }
      
      const userData = await r.json();
      const user = userData.user;
      
      // Check if user is valid (not anonymous)
      if (!user || !user.id || user.id === null || user.email === 'invalid@example.com') {
        log('invalid or anonymous user', user);
        return false;
      }
      
      const b = await fetch(`${CONFIG.BACKEND_URL}/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, email: user.email, name: user.name })
      });
      if (!b.ok) {
        log('backend bootstrap failed', b.status);
        return false;
      }
      
      const data = await b.json();
      state.jwt = data.jwt;
      state.jwtExpiry = Date.now() + (data.ttl_ms || 0);
      state.userId = user.id;
      lsSet('jwt', state.jwt); lsSet('jwtExpiry', state.jwtExpiry); lsSet('userId', state.userId);
      log('bootstrap ok', { uid: user.id });
      return true;
    } catch (e) {
      log('bootstrap fail', e);
      return false;
    }
  }

  // Envío de pings
  async function sendPing(kind = 'hb', force = false) {
    if (!state.jwt || Date.now() >= state.jwtExpiry) return;
    const cur = getCurrentState();

    // Anti-flood para pings de cambio de estado
    if (kind === 'state' && !force) {
      const now = Date.now();
      if (state.lastSentState === cur && (now - state.lastStateEmitAt) < CONFIG.STATE_MIN_INTERVAL_MS) {
        return;
      }
      state.lastSentState = cur;
      state.lastStateEmitAt = now;
    }

    const payload = {
      ts: new Date().toISOString(),
      jwt: state.jwt,
      kind,                        // 'hb' | 'state' | 'pagehide' | 'manual'
      state: cur,                  // ZTK | IDLE_ZENDESK | WEB_ACTIVA | IDLE_WEB | BG
      domain: location.hostname,
      path: location.pathname,
      title: (document.title || '').slice(0, 140),
      tab_id: state.tabId,
      ref_ticket_id: currentTicketId()
    };

    try {
      const ok = navigator.sendBeacon(
        `${CONFIG.BACKEND_URL}/activity`,
        new Blob([JSON.stringify(payload)], { type: 'application/json' })
      );
      if (!ok) throw new Error('sendBeacon=false');
      log('ping', { kind: payload.kind, st: payload.state, tid: payload.ref_ticket_id });
    } catch {
      try {
        const r = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), keepalive: true
        });
        if (!r.ok) throw new Error('http ' + r.status);
        log('ping/fetch', { kind: payload.kind, st: payload.state });
      } catch (err) {
        log('ping fail', err);
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    const tick = () => { sendPing('hb'); state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS)); };
    state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS));
    log('hb start');
  }
  function stopHeartbeat() { if (state.hbTimer) { clearTimeout(state.hbTimer); state.hbTimer = null; log('hb stop'); } }

  // Emisión inmediata si el estado cambia (focus/visibility/idle)
  function emitStateIfChanged(force=false) {
    const cur = getCurrentState();
    if (state.lastSentState !== cur || force) {
      void sendPing('state', force);
    }
  }

  // Idle watcher: dispara 'state' al entrar en idle
  function resetIdleTimer() {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    const due = state.lastActivity + CONFIG.IDLE_MS - Date.now();
    const wait = Math.max(0, due);
    state.idleTimer = setTimeout(() => {
      // Entra a estado IDLE_* (o BG si perdió foco entretanto)
      emitStateIfChanged(true);
    }, wait + 10); // pequeño margen
  }

  // Listeners
  function trackActivity() {
    state.lastActivity = Date.now();
    resetIdleTimer();
    // Si veníamos de idle, esto cambia a ZTK/WEB_ACTIVA → emitir borde:
    emitStateIfChanged();
  }

  function setupActivityListeners() {
    ['mousedown','mousemove','keydown','scroll','touchstart','pointerdown','pointermove','wheel'].forEach(ev =>
      document.addEventListener(ev, trackActivity, { passive: true })
    );

    document.addEventListener('visibilitychange', () => {
      state.isVisible = !document.hidden;
      emitStateIfChanged(true); // borde exacto al cambiar visibilidad
    });

    window.addEventListener('focus', () => { state.hasFocus = true; emitStateIfChanged(true); });
    window.addEventListener('blur',  () => { state.hasFocus = false; emitStateIfChanged(true); });

    window.addEventListener('beforeunload', () => { sendPing('pagehide', true); });
    window.addEventListener('pagehide',      () => { sendPing('pagehide', true); });
  }

  // SPA hooks (Zendesk)
  function setupSPAHooks() {
    const oPush = history.pushState, oReplace = history.replaceState;
    history.pushState = function(...a){ oPush.apply(this, a); setTimeout(updateTicketRef, 100); };
    history.replaceState = function(...a){ oReplace.apply(this, a); setTimeout(updateTicketRef, 100); };
    window.addEventListener('popstate', () => setTimeout(updateTicketRef, 100));

    if (isZendesk()) {
      const mo = new MutationObserver(() => setTimeout(updateTicketRef, 300));
      const boot = () => document.body ? (mo.observe(document.body, { childList:true, subtree:true }), true) : false;
      if (!boot()) document.addEventListener('DOMContentLoaded', boot, { once:true });
      log('SPA hooks installed');
    }
  }

  // Init
  async function initialize() {
    log('init…');
    state.isZendesk = isZendesk();
    
    // Skip initialization on API endpoints or invalid pages
    if (location.pathname.includes('/api/') || location.pathname.includes('.json')) {
      log('skipping API endpoint');
      return;
    }
    
    setupActivityListeners();
    setupSPAHooks();

    // Only try bootstrap on Zendesk and after page is fully loaded
    if (state.isZendesk && document.readyState === 'complete') {
      const have = loadAuth();
      if (!have) { 
        // Add delay to ensure Zendesk is fully loaded
        setTimeout(async () => {
          await bootstrapAuth();
          if (state.jwt) {
            updateTicketRef();
            startHeartbeat();
            resetIdleTimer();
            emitStateIfChanged(true);
          }
        }, 2000);
      } else if (state.jwt) {
        updateTicketRef();
        startHeartbeat();
        resetIdleTimer();
        emitStateIfChanged(true);
      }
    } else if (!state.isZendesk) {
      // Non-Zendesk sites - just track activity if we have auth
      const have = loadAuth();
      if (have && state.jwt) {
        startHeartbeat();
        resetIdleTimer();
        emitStateIfChanged(true);
      }
    }

    log('ready', { zendesk: state.isZendesk, authed: !!state.jwt, tab: state.tabId });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once:true });
  } else {
    setTimeout(initialize, 50);
  }

  // Solo expone info no sensible
  window.okSmartAudit = {
    ping: () => sendPing('manual', true),
    stateInfo: () => ({
      authed: !!state.jwt,
      tab: state.tabId,
      zendesk: state.isZendesk,
      state: getCurrentState()
    }),
    config: { ...CONFIG, BACKEND_URL: '[redacted]' }
  };
})();
