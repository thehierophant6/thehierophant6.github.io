// ==UserScript==
// @name         OK Smart Audit
// @namespace    https://okmobility.com/
// @version      1.3.0
// @description  Multi-domain activity tracker with enhanced Zendesk support
// @author       OK Mobility
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;  // Production mode
  const log = (...a) => { if (DEBUG) console.log('[OK Smart Audit]', ...a); };

  // Config
  const CONFIG = {
    BACKEND_URL: 'https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api',
    HEARTBEAT_MS: 30000,         // latido base
    JITTER_MS: 2000,             // ±2s
    IDLE_MS: 60000,              // 60s → idle normal
    IDLE_ZENDESK_MS: 90000,      // 90s → idle en Zendesk (lectura)
    REF_TICKET_TTL_MS: 7 * 60 * 1000,
    ZD_HOST_REGEX: /\.zendesk\.com$/,
    STORAGE_PREFIX: 'ok_smart_audit_',
    STATE_MIN_INTERVAL_MS: 1500,  // anti-flood entre pings de cambio de estado
    DOMAINS_TO_TRACK: [
      'zendesk.com',
      'youtube.com',
      'facebook.com', 
      'instagram.com',
      'twitter.com',
      'x.com',
      'tiktok.com',
      'whatsapp.com',
      'gmail.com',
      'outlook.com',
      'netflix.com',
      'amazon.com',
      'mercadolibre.com',
      'google.com',
      'bing.com'
    ]
  };

  // Estado
  const state = {
    jwt: null,
    userId: null,
    jwtExpiry: 0,
    refreshToken: null,
    refreshExpiry: 0,
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

  function isTrackedDomain() {
    const hostname = location.hostname.toLowerCase();
    return CONFIG.DOMAINS_TO_TRACK.some(domain => 
      hostname.includes(domain.toLowerCase())
    );
  }

  function getDomainCategory() {
    const hostname = location.hostname.toLowerCase();
    
    if (hostname.includes('zendesk.com')) return 'WORK';
    if (hostname.includes('youtube.com') || 
        hostname.includes('netflix.com') || 
        hostname.includes('tiktok.com')) return 'ENTERTAINMENT';
    if (hostname.includes('facebook.com') || 
        hostname.includes('instagram.com') || 
        hostname.includes('twitter.com') || 
        hostname.includes('x.com') || 
        hostname.includes('whatsapp.com')) return 'SOCIAL';
    if (hostname.includes('gmail.com') || 
        hostname.includes('outlook.com')) return 'EMAIL';
    if (hostname.includes('amazon.com') || 
        hostname.includes('mercadolibre.com')) return 'SHOPPING';
    if (hostname.includes('google.com') || 
        hostname.includes('bing.com')) return 'SEARCH';
    
    return 'OTHER';
  }

  // Ticket helpers
  function extractTicketId() { const m = location.pathname.match(/\/agent\/tickets\/(\d+)/); return m ? parseInt(m[1], 10) : null; }
  function updateTicketRef() {
    const tid = extractTicketId();
    if (tid) {
      if (tid !== state.lastTicketId) {
        state.lastTicketId = tid;
        log('ticket ref', tid);
        emitStateIfChanged(true); // corta segmento ZTK a ticket correcto ASAP
      }
      // Renovar TTL siempre que estemos en un ticket (mantener referencia activa)
      state.lastTicketExpiry = Date.now() + CONFIG.REF_TICKET_TTL_MS;
    }
  }
  function currentTicketId() { return (state.lastTicketId && Date.now() < state.lastTicketExpiry) ? state.lastTicketId : null; }

  // Estado lógico actual
  function getCurrentState() {
    // Usar umbral diferente para Zendesk con ticket (lectura permitida)
    const idleThreshold = (state.isZendesk && state.lastTicketId) ? 
      CONFIG.IDLE_ZENDESK_MS : CONFIG.IDLE_MS;
    
    const idle = (Date.now() - state.lastActivity) >= idleThreshold;
    if (!state.isVisible || !state.hasFocus) return 'BG';                    // pestaña oculta o sin foco
    if (state.isZendesk) return idle ? 'IDLE_ZENDESK' : 'ZTK';               // foco + Zendesk
    return idle ? 'IDLE_WEB' : 'WEB_ACTIVA';                                 // foco + otra web
  }

  // AUTENTICACIÓN
  function loadAuth() {
    const jwt = lsGet('jwt', null);
    const exp = lsGet('jwtExpiry', 0);
    const uid = lsGet('userId', null);
    const refreshToken = lsGet('refreshToken', null);
    const refreshExp = lsGet('refreshExpiry', 0);
    
    if (jwt && exp && Date.now() < exp) {
      state.jwt = jwt; 
      state.jwtExpiry = exp; 
      state.userId = uid;
      state.refreshToken = refreshToken;
      state.refreshExpiry = refreshExp;
      log('auth loaded', { userId: uid });
      return true;
    }
    
    // JWT expired but refresh token might still be valid
    if (refreshToken && refreshExp && Date.now() < refreshExp) {
      state.refreshToken = refreshToken;
      state.refreshExpiry = refreshExp;
      state.userId = uid;
      log('JWT expired but refresh token available');
      return 'refresh_needed';
    }
    
    // Clear all auth data
    lsDel('jwt'); lsDel('jwtExpiry'); lsDel('userId'); lsDel('refreshToken'); lsDel('refreshExpiry');
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
        body: JSON.stringify({ user_id: user.id, email: user.email, name: user.name }),
        credentials: 'omit'  // Explicitly omit credentials
      });
      if (!b.ok) {
        log('backend bootstrap failed', b.status);
        return false;
      }
      
      const data = await b.json();
      state.jwt = data.jwt;
      state.jwtExpiry = Date.now() + (data.ttl_ms || 0);
      state.refreshToken = data.refresh_token;
      state.refreshExpiry = Date.now() + (data.refresh_ttl_ms || 0);
      state.userId = user.id;
      
      lsSet('jwt', state.jwt); 
      lsSet('jwtExpiry', state.jwtExpiry); 
      lsSet('refreshToken', state.refreshToken);
      lsSet('refreshExpiry', state.refreshExpiry);
      lsSet('userId', state.userId);
      
      log('bootstrap ok', { uid: user.id });
      return true;
    } catch (e) {
      log('bootstrap fail', e);
      return false;
    }
  }

  async function refreshJWT() {
    if (!state.refreshToken || Date.now() >= state.refreshExpiry) {
      log('refresh token expired or missing');
      // If we're on Zendesk and refresh token is gone, try bootstrap directly
      if (state.isZendesk) {
        log('attempting bootstrap fallback from refreshJWT');
        return await bootstrapAuth();
      }
      return false;
    }
    
    try {
      log('refreshing JWT with refresh token');
      const r = await fetch(`${CONFIG.BACKEND_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.refreshToken }),
        credentials: 'omit'
      });
      
      if (!r.ok) {
        log('refresh failed', r.status);
        // Clear invalid refresh token
        lsDel('refreshToken'); lsDel('refreshExpiry');
        state.refreshToken = null;
        state.refreshExpiry = 0;
        // Try bootstrap fallback if on Zendesk
        if (state.isZendesk) {
          log('attempting bootstrap fallback after refresh failure');
          return await bootstrapAuth();
        }
        return false;
      }
      
      const data = await r.json();
      state.jwt = data.jwt;
      state.jwtExpiry = Date.now() + (data.ttl_ms || 0);
      
      lsSet('jwt', state.jwt);
      lsSet('jwtExpiry', state.jwtExpiry);
      
      log('JWT refreshed successfully');
      return true;
    } catch (e) {
      log('refresh error', e);
      // Try bootstrap fallback if on Zendesk
      if (state.isZendesk) {
        log('attempting bootstrap fallback after refresh exception');
        return await bootstrapAuth();
      }
      return false;
    }
  }

  // Envío de pings
  async function sendPing(kind = 'hb', force = false) {
    // Check if JWT is expired and try to renew
    if (!state.jwt || Date.now() >= state.jwtExpiry) {
      log('JWT expired, attempting renewal');
      
      // Try refresh token first
      const refreshed = await refreshJWT();
      if (!refreshed) {
        // Refresh failed, try bootstrap if we're on Zendesk
        if (state.isZendesk) {
          const bootstrapped = await bootstrapAuth();
          if (!bootstrapped) {
            log('No valid JWT, skipping ping');
            return;
          }
        } else {
          log('No valid JWT, skipping ping');
          return;
        }
      }
    }
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
      ref_ticket_id: currentTicketId(),
      domain_category: getDomainCategory(),
      is_tracked_domain: isTrackedDomain()
    };

    try {
      // Use fetch instead of sendBeacon to avoid CORS credential issues
      const r = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), 
        keepalive: true,
        credentials: 'omit'  // Explicitly omit credentials
      });
      
      if (r.status === 401) {
        log('401 Unauthorized - JWT expired, attempting refresh');
        let renewed = false;
        
        // Try refresh token first
        if (await refreshJWT()) {
          renewed = true;
        } else if (state.isZendesk && await bootstrapAuth()) {
          // Fallback to bootstrap if refresh failed
          renewed = true;
        }
        
        if (renewed) {
          // Retry with new JWT
          payload.jwt = state.jwt;
          const retry = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload), 
            keepalive: true,
            credentials: 'omit'
          });
          if (!retry.ok) throw new Error('retry http ' + retry.status);
          log('ping retry success', { kind: payload.kind, st: payload.state, tid: payload.ref_ticket_id });
        } else {
          throw new Error('JWT renewal failed');
        }
      } else if (!r.ok) {
        throw new Error('http ' + r.status);
      } else {
        log('ping', { kind: payload.kind, st: payload.state, tid: payload.ref_ticket_id });
      }
    } catch (err) {
      log('ping fail', err);
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

  // Idle watcher: dispara 'state' al entrar en idle (con umbral dinámico)
  function resetIdleTimer() {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    
    // Usar umbral diferente para Zendesk con ticket
    const idleThreshold = (state.isZendesk && state.lastTicketId) ? 
      CONFIG.IDLE_ZENDESK_MS : CONFIG.IDLE_MS;
    
    const due = state.lastActivity + idleThreshold - Date.now();
    const wait = Math.max(0, due);
    state.idleTimer = setTimeout(() => {
      // Entra a estado IDLE_* (o BG si perdió foco entretanto)
      emitStateIfChanged(true);
    }, wait + 10); // pequeño margen
  }

  // Cross-tab synchronization
  function syncTokensFromStorage() {
    const jwt = lsGet('jwt', null);
    const jwtExp = lsGet('jwtExpiry', 0);
    const refreshToken = lsGet('refreshToken', null);
    const refreshExp = lsGet('refreshExpiry', 0);
    
    // Update state if we found newer tokens
    if (jwt && jwtExp > state.jwtExpiry) {
      state.jwt = jwt;
      state.jwtExpiry = jwtExp;
      log('synced newer JWT from another tab');
    }
    
    if (refreshToken && refreshExp > state.refreshExpiry) {
      state.refreshToken = refreshToken;
      state.refreshExpiry = refreshExp;
      log('synced newer refresh token from another tab');
    }
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
    
    // Cross-tab token synchronization
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith(CONFIG.STORAGE_PREFIX)) {
        log('localStorage changed in another tab, syncing tokens');
        syncTokensFromStorage();
      }
    });
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

  // Clean legacy localStorage keys
  function cleanLegacyStorage() {
    ['jwt','jwtExpiry','userId','refreshToken','refreshExpiry'].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
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

    // Solo trackear en dominios relevantes o si ya tenemos auth
    const shouldTrack = isTrackedDomain() || lsGet('jwt', null);
    if (!shouldTrack) {
      log('domain not tracked and no existing auth, skipping');
      return;
    }
    
    log('domain:', location.hostname, 'category:', getDomainCategory(), 'tracked:', isTrackedDomain());
    
    // Clean legacy storage once
    cleanLegacyStorage();
    
    setupActivityListeners();
    setupSPAHooks();

    // Only try bootstrap on Zendesk
    if (state.isZendesk) {
      const authStatus = loadAuth();
      if (authStatus === true) {
        // Valid JWT, start tracking
        updateTicketRef();
        startHeartbeat();
        resetIdleTimer();
        emitStateIfChanged(true);
      } else if (authStatus === 'refresh_needed') {
        // Try to refresh JWT first
        const tryBootstrap = async () => {
          log('attempting bootstrap...');
          const success = await bootstrapAuth();
          if (success && state.jwt) {
            log('bootstrap successful, starting tracking');
            updateTicketRef();
            startHeartbeat();
            resetIdleTimer();
            emitStateIfChanged(true);
          } else {
            log('bootstrap failed, will retry');
          }
        };
        
        const tryRefresh = async () => {
          log('attempting JWT refresh...');
          const refreshed = await refreshJWT();
          if (refreshed && state.jwt) {
            log('refresh successful, starting tracking');
            updateTicketRef();
            startHeartbeat();
            resetIdleTimer();
            emitStateIfChanged(true);
          } else {
            log('refresh failed, trying bootstrap');
            // Fallback to bootstrap
            setTimeout(tryBootstrap, 500);
          }
        };
        setTimeout(tryRefresh, 500);
      } else {
        // No valid auth, try bootstrap
        const tryBootstrap = async () => {
          log('attempting bootstrap...');
          const success = await bootstrapAuth();
          if (success && state.jwt) {
            log('bootstrap successful, starting tracking');
            updateTicketRef();
            startHeartbeat();
            resetIdleTimer();
            emitStateIfChanged(true);
          } else {
            log('bootstrap failed, will retry');
          }
        };
        
        // Try immediately
        setTimeout(tryBootstrap, 500);
        // Try again after 3 seconds
        setTimeout(tryBootstrap, 3000);
        // Try again after 10 seconds (final attempt)
        setTimeout(tryBootstrap, 10000);
      }
    } else if (!state.isZendesk) {
      // Non-Zendesk sites - just track activity if we have auth
      const authStatus = loadAuth();
      if (authStatus === true && state.jwt) {
        startHeartbeat();
        resetIdleTimer();
        emitStateIfChanged(true);
      } else if (authStatus === 'refresh_needed') {
        // Try to refresh for non-Zendesk sites too
        const tryRefresh = async () => {
          const refreshed = await refreshJWT();
          if (refreshed && state.jwt) {
            startHeartbeat();
            resetIdleTimer();
            emitStateIfChanged(true);
          }
        };
        setTimeout(tryRefresh, 500);
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
    bootstrap: bootstrapAuth,  // Exponer bootstrap para debug
    stateInfo: () => ({
      authed: !!state.jwt,
      tab: state.tabId,
      zendesk: state.isZendesk,
      state: getCurrentState()
    }),
    config: { ...CONFIG, BACKEND_URL: '[redacted]' }
  };
})();
