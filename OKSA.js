// ==UserScript==
// @name         OK Smart Audit
// @namespace    https://okmobility.com/
// @version      1.0.1
// @description  Activity tracker for Zendesk agents (cross-domain safe)
// @author       OK Mobility
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;

  const CONFIG = {
    BACKEND_URL: 'https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api',
    HEARTBEAT_MS: 30000,
    JITTER_MS: 2000,
    IDLE_MS: 60000,
    REF_TICKET_TTL_MS: 7 * 60 * 1000,
    ZD_HOST_REGEX: /\.zendesk\.com$/,
    STORAGE_PREFIX: 'ok_smart_audit_',
    // (Opcional) bloquear dominios sensibles:
    // BLOCKLIST: [/^mail\.google\.com$/, /^bank\./]
    BLOCKLIST: []
  };

  // ---------- Utils ----------
  const log = (...args) => { if (DEBUG) console.log('[OK Smart Audit]', ...args); };

  const jitter = (ms) => Math.max(1000, ms + (Math.random() - 0.5) * 2 * CONFIG.JITTER_MS);
  const isZendesk = () => CONFIG.ZD_HOST_REGEX.test(location.hostname);
  const inBlocklist = () => CONFIG.BLOCKLIST.some(rx => rx.test(location.hostname));

  const now = () => Date.now();
  const genTabId = () => 'tab_' + Math.random().toString(36).slice(2, 11) + '_' + now();

  // localStorage helpers (scoped por dominio)
  const lsKey = (k) => CONFIG.STORAGE_PREFIX + k;
  const lsSet = (k, v) => { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch {} };
  const lsGet = (k, d=null) => { try { const s = localStorage.getItem(lsKey(k)); return s ? JSON.parse(s) : d; } catch { return d; } };
  const lsDel = (k) => { try { localStorage.removeItem(lsKey(k)); } catch {} };

  // GM storage (global por script, ideal para compartir JWT entre dominios)
  const gmSet = (k, v) => GM_setValue(CONFIG.STORAGE_PREFIX + k, v);
  const gmGet = (k, d=null) => {
    const v = GM_getValue(CONFIG.STORAGE_PREFIX + k);
    return (v === undefined ? d : v);
  };

  // ---------- State ----------
  const state = {
    jwt: null,
    jwtExpiry: 0,
    userId: null,
    lastActivity: now(),
    lastTicketId: null,
    lastTicketExpiry: 0,
    tabId: genTabId(),
    isVisible: true,
    hasFocus: true,
    isZendesk: false,
    hbTimer: null
  };

  // ---------- Ticket helpers ----------
  const extractTicketId = () => {
    const m = location.pathname.match(/\/agent\/tickets\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  };

  const updateTicketRef = () => {
    const tid = extractTicketId();
    if (tid && tid !== state.lastTicketId) {
      state.lastTicketId = tid;
      state.lastTicketExpiry = now() + CONFIG.REF_TICKET_TTL_MS;
      log('ticket ref', tid);
    }
  };

  const currentTicketId = () => (state.lastTicketId && now() < state.lastTicketExpiry) ? state.lastTicketId : null;

  // ---------- Auth (JWT) ----------
  // Carga preferentemente de GM storage (cross-domain)
  function loadAuth() {
    // 1) GM (global)
    const gjwt = gmGet('jwt', null);
    const gexp = gmGet('jwtExpiry', 0);
    const guid = gmGet('userId', null);

    if (gjwt && gexp > now()) {
      state.jwt = gjwt;
      state.jwtExpiry = gexp;
      state.userId = guid;
      log('JWT loaded from GM', { userId: state.userId });
      return true;
    }

    // 2) Fallback: localStorage (solo mismo dominio)
    const sjwt = lsGet('jwt', null);
    const sexp = lsGet('jwtExpiry', 0);
    const suid = lsGet('userId', null);
    if (sjwt && sexp > now()) {
      state.jwt = sjwt;
      state.jwtExpiry = sexp;
      state.userId = suid;
      log('JWT loaded from localStorage', { userId: state.userId });
      // Sincroniza a GM para uso cross-domain
      gmSet('jwt', state.jwt);
      gmSet('jwtExpiry', state.jwtExpiry);
      gmSet('userId', state.userId);
      return true;
    }

    // Limpia expirado
    lsDel('jwt'); lsDel('jwtExpiry'); lsDel('userId');
    gmSet('jwt', null); gmSet('jwtExpiry', 0); gmSet('userId', null);
    return false;
  }

  async function bootstrapAuth() {
    if (!isZendesk()) {
      log('not zendesk; skip bootstrap');
      return false;
    }
    try {
      const r = await fetch('/api/v2/users/me.json', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Zendesk me ' + r.status);
      const me = await r.json();
      const user = me.user || {};
      // (No logueamos email por privacidad)
      log('me:', { id: user.id, name: user.name });

      const b = await fetch(`${CONFIG.BACKEND_URL}/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, email: user.email, name: user.name })
      });
      if (!b.ok) throw new Error('bootstrap ' + b.status);
      const data = await b.json();

      state.jwt = data.jwt;
      state.jwtExpiry = now() + (data.ttl_ms || 0);
      state.userId = user.id;

      // Guarda en GM (global) y LS (origen)
      gmSet('jwt', state.jwt); gmSet('jwtExpiry', state.jwtExpiry); gmSet('userId', state.userId);
      lsSet('jwt', state.jwt); lsSet('jwtExpiry', state.jwtExpiry); lsSet('userId', state.userId);

      log('bootstrap ok', { userId: state.userId, ttlMs: data.ttl_ms });
      return true;
    } catch (e) {
      log('bootstrap fail', e);
      return false;
    }
  }

  // Si otra pestaña renueva el JWT, nos enteramos
  const gmListenerId = GM_addValueChangeListener(CONFIG.STORAGE_PREFIX + 'jwt', (_k, _o, n) => {
    if (typeof n === 'string' && n) {
      state.jwt = n;
      state.jwtExpiry = gmGet('jwtExpiry', 0);
      state.userId = gmGet('userId', null);
      log('JWT updated via GM listener');
      if (!state.hbTimer) startHeartbeat();
    }
  });

  // ---------- Activity state ----------
  const currentState = () => {
    if (!state.isVisible || !state.hasFocus) return 'BG';
    const idle = (now() - state.lastActivity) >= CONFIG.IDLE_MS;
    if (state.isZendesk) return idle ? 'IDLE_ZENDESK' : 'ZTK';
    return idle ? 'IDLE_WEB' : 'WEB_ACTIVA';
  };

  // ---------- Ping ----------
  async function sendPing(kind = 'hb') {
    if (inBlocklist()) return;
    if (!state.jwt || state.jwtExpiry <= now()) {
      log('no jwt / expired; skip ping');
      return;
    }
    const payload = {
      ts: new Date().toISOString(),
      jwt: state.jwt,
      kind,
      state: currentState(),
      domain: location.hostname,
      path: location.pathname,           // sin query por privacidad
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
    } catch (e) {
      // fallback
      try {
        const r = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
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
    const tick = () => {
      sendPing('hb');
      state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS));
    };
    state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS));
    log('hb start');
  }

  function stopHeartbeat() {
    if (state.hbTimer) {
      clearTimeout(state.hbTimer);
      state.hbTimer = null;
      log('hb stop');
    }
  }

  // ---------- Listeners ----------
  function markActivity() { state.lastActivity = now(); }
  function setupListeners() {
    ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, markActivity, { passive: true })
    );
    document.addEventListener('visibilitychange', () => { state.isVisible = !document.hidden; });
    window.addEventListener('focus', () => { state.hasFocus = true; });
    window.addEventListener('blur', () => { state.hasFocus = false; });
    window.addEventListener('beforeunload', () => sendPing('pagehide'));
    window.addEventListener('pagehide', () => sendPing('pagehide'));

    // SPA hooks
    const oPush = history.pushState, oReplace = history.replaceState;
    history.pushState = function (...a) { oPush.apply(this, a); setTimeout(updateTicketRef, 100); };
    history.replaceState = function (...a) { oReplace.apply(this, a); setTimeout(updateTicketRef, 100); };
    window.addEventListener('popstate', () => setTimeout(updateTicketRef, 100));

    if (isZendesk()) {
      const mo = new MutationObserver(() => setTimeout(updateTicketRef, 300));
      const bodyReady = () => document.body ? (mo.observe(document.body, { childList: true, subtree: true }), true) : false;
      if (!bodyReady()) document.addEventListener('DOMContentLoaded', bodyReady, { once: true });
      log('SPA hooks installed');
    }
  }

  // ---------- Init ----------
  async function init() {
    state.isZendesk = isZendesk();
    setupListeners();

    const have = loadAuth();
    if (!have && state.isZendesk) {
      await bootstrapAuth();
    }

    // Empezar a latir si hay JWT (ahora también en dominios no Zendesk gracias a GM storage)
    if (state.jwt) {
      updateTicketRef();
      startHeartbeat();
    } else {
      log('no auth; no hb');
    }

    log('init', { zendesk: state.isZendesk, authed: !!state.jwt, tab: state.tabId, host: location.hostname });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 50);
  }

  // No exponemos JWT ni state completo en window (solo utilidades seguras)
  window.okSmartAudit = {
    ping: () => sendPing('manual'),
    stateInfo: () => ({
      authed: !!state.jwt,
      expInSec: Math.max(0, Math.floor((state.jwtExpiry - now()) / 1000)),
      tab: state.tabId,
      zendesk: state.isZendesk
    }),
    config: { ...CONFIG, BACKEND_URL: '[redacted]' }, // no revelar URL en consola accidental
  };

  // Cleanup al salir del documento
  window.addEventListener('unload', () => {
    try { GM_removeValueChangeListener(gmListenerId); } catch {}
    stopHeartbeat();
  });
})();
