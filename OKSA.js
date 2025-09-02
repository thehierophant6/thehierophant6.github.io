// ==UserScript==
// @name         OK Smart Audit
// @namespace    https://okmobility.com/
// @version      1.3.1
// @description  Multi-domain activity tracker with enhanced Zendesk support
// @author       OK Mobility
// @match        *://*/*
// @match        *://*.zendesk.com/*
// @match        *://*.youtube.com/*
// @match        *://*.google.com/*
// @match        *://*.facebook.com/*
// @match        *://*.twitter.com/*
// @match        *://*.instagram.com/*
// @match        *://*.gmail.com/*
// @match        *://*.netflix.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net
// @connect      westeurope-01.azurewebsites.net
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true;  // Enable debug for tracking issues
  const log = (...a) => { if (DEBUG) console.log('[OK Smart Audit]', ...a); };

  log('Script loaded, initializing...');

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
    lastHeartbeatDomain: null,
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
    const isTracked = CONFIG.DOMAINS_TO_TRACK.some(domain =>
      hostname.includes(domain.toLowerCase())
    );
    log('Domain check:', hostname, 'tracked:', isTracked);
    return isTracked;
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
    // Update domain state dynamically
    state.isZendesk = isZendesk();

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
  async function sendPing(kind = 'hb', force = false, allowWithoutAuth = false) {
    // Only send pings for tracked domains or Zendesk
    const shouldTrack = isTrackedDomain() || state.isZendesk;
    if (!shouldTrack) {
      log('Skipping ping for non-tracked domain:', location.hostname);
      return;
    }

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
            if (!allowWithoutAuth) {
              log('No valid JWT, skipping ping');
              return;
            }
            log('No valid JWT but allowWithoutAuth=true, sending ping anyway');
          }
        } else {
          // For non-Zendesk sites, don't skip pings - continue with 'no-auth'
          if (!allowWithoutAuth) {
            log('No valid JWT on non-Zendesk site, but allowing ping anyway for tracking');
            allowWithoutAuth = true; // Force allow for non-Zendesk sites
          }
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
      jwt: state.jwt || 'no-auth', // Permite funcionar sin JWT
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
      log('Sending ping:', payload);
      // Use fetch instead of sendBeacon to avoid CORS credential issues
      const r = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: 'omit'  // Explicitly omit credentials
      });

      log('Ping response:', r.status, r.statusText);

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
        log('ping success', { kind: payload.kind, st: payload.state, tid: payload.ref_ticket_id });
      }
    } catch (err) {
      log('ping fail', err);
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    const tick = () => {
      // Check if domain has changed since last heartbeat
      const currentDomain = location.hostname;
      const currentIsZendesk = isZendesk();

      if (currentDomain !== state.lastHeartbeatDomain || currentIsZendesk !== state.isZendesk) {
        log(`Domain changed in heartbeat: ${state.lastHeartbeatDomain} -> ${currentDomain}`);
        state.lastHeartbeatDomain = currentDomain;
        state.isZendesk = currentIsZendesk;
        // Force a state change ping when domain changes
        emitStateIfChanged(true, true);
      } else {
        sendPing('hb');
      }
      state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS));
    };

    // Initialize domain tracking
    state.lastHeartbeatDomain = location.hostname;
    state.isZendesk = isZendesk();

    state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS));
    log('hb start');
  }
  function stopHeartbeat() { if (state.hbTimer) { clearTimeout(state.hbTimer); state.hbTimer = null; log('hb stop'); } }

  // Emisión inmediata si el estado cambia (focus/visibility/idle)
  function emitStateIfChanged(force=false, allowWithoutAuth=false) {
    const cur = getCurrentState();
    if (state.lastSentState !== cur || force) {
      void sendPing('state', force, allowWithoutAuth);
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
      emitStateIfChanged(true, !state.isZendesk);
    }, wait + 10); // pequeño margen
  }

  // Cross-tab synchronization
  function syncTokensFromStorage() {
    const jwt = lsGet('jwt', null);
    const jwtExp = lsGet('jwtExpiry', 0);
    const refreshToken = lsGet('refreshToken', null);
    const refreshExp = lsGet('refreshExpiry', 0);

    let updated = false;

    // Update state if we found newer tokens
    if (jwt && jwtExp > state.jwtExpiry) {
      state.jwt = jwt;
      state.jwtExpiry = jwtExp;
      log('synced newer JWT from another tab');
      updated = true;
    }

    if (refreshToken && refreshExp > state.refreshExpiry) {
      state.refreshToken = refreshToken;
      state.refreshExpiry = refreshExp;
      log('synced newer refresh token from another tab');
      updated = true;
    }

    // If we got new tokens and we're on a non-Zendesk site, restart heartbeat if needed
    if (updated && !state.isZendesk && jwt && jwtExp > Date.now()) {
      log('Got new JWT on non-Zendesk site, restarting heartbeat');
      startHeartbeat();
    }
  }

  // Listeners
  function trackActivity() {
    state.lastActivity = Date.now();
    resetIdleTimer();
    // Si veníamos de idle, esto cambia a ZTK/WEB_ACTIVA → emitir borde:
    // Permitir tracking sin auth si no estamos en Zendesk
    emitStateIfChanged(false, !state.isZendesk);
  }

  function setupActivityListeners() {
    ['mousedown','mousemove','keydown','scroll','touchstart','pointerdown','pointermove','wheel'].forEach(ev =>
      document.addEventListener(ev, trackActivity, { passive: true })
    );

    document.addEventListener('visibilitychange', () => {
      state.isVisible = !document.hidden;
      emitStateIfChanged(true, !state.isZendesk); // borde exacto al cambiar visibilidad
    });

    window.addEventListener('focus', () => { state.hasFocus = true; emitStateIfChanged(true, !state.isZendesk); });
    window.addEventListener('blur',  () => { state.hasFocus = false; emitStateIfChanged(true, !state.isZendesk); });

    window.addEventListener('beforeunload', () => { sendPing('pagehide', true); });
    window.addEventListener('pagehide',      () => { sendPing('pagehide', true); });

    // Cross-tab token synchronization
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith(CONFIG.STORAGE_PREFIX)) {
        log('localStorage changed in another tab, syncing tokens');
        syncTokensFromStorage();
      }
    });

    // Detect domain changes and force state update
    let lastDomain = location.hostname;
    const checkDomainChange = () => {
      const currentDomain = location.hostname;
      if (currentDomain !== lastDomain) {
        log(`Domain changed from ${lastDomain} to ${currentDomain}`);
        lastDomain = currentDomain;
        // Update domain state immediately
        state.isZendesk = isZendesk();
        // Force a state change ping to capture the domain transition
        emitStateIfChanged(true, true); // Allow without auth for immediate feedback
      }
    };

    // Check for domain changes on navigation events
    window.addEventListener('popstate', checkDomainChange);
    window.addEventListener('hashchange', checkDomainChange);

    // Also check periodically for SPA navigation
    setInterval(checkDomainChange, 1000);

    // Force initial domain check
    checkDomainChange();
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

    const shouldTrack = isTrackedDomain() || state.isZendesk;
    const currentDomain = location.hostname.toLowerCase();
    log('Current domain:', currentDomain, 'tracked:', shouldTrack, 'zendesk:', state.isZendesk);

    // Only setup tracking for tracked domains or Zendesk
    if (!shouldTrack) {
      log('Domain not tracked, minimal setup only');
      // Still expose debug functions for non-tracked domains
      const debugAPI = {
        stateInfo: () => ({
          authed: !!state.jwt,
          tab: state.tabId,
          zendesk: state.isZendesk,
          currentState: 'NOT_TRACKED',
          domain: location.hostname,
          isTracked: false,
          category: getDomainCategory(),
          message: 'Domain not in tracking list'
        })
      };

      // Expose immediately for non-tracked domains
      try {
        window.okSmartAudit = debugAPI;
      } catch (e) {
        try {
          if (typeof unsafeWindow !== 'undefined') {
            unsafeWindow.okSmartAudit = debugAPI;
          }
        } catch (e2) {
          log('Failed to expose debug API on non-tracked domain');
        }
      }

      log('Minimal setup complete for non-tracked domain');
      return;
    }

    // Setup activity listeners for tracked domains
    setupActivityListeners();
    setupSPAHooks();

    log('domain:', location.hostname, 'category:', getDomainCategory(), 'tracked:', isTrackedDomain());

    // Clean legacy storage once
    cleanLegacyStorage();

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
      // Non-Zendesk sites - track activity if we have auth OR try to get auth
      const authStatus = loadAuth();

      if (authStatus === true && state.jwt) {
        log('Non-Zendesk site with valid JWT, starting tracking');
        startHeartbeat();
        resetIdleTimer();
        emitStateIfChanged(true);
      } else if (authStatus === 'refresh_needed') {
        log('Non-Zendesk site with refresh token available');
        // Try to refresh for non-Zendesk sites too
        const tryRefresh = async () => {
          const refreshed = await refreshJWT();
          if (refreshed && state.jwt) {
            log('JWT refreshed successfully on non-Zendesk site');
            startHeartbeat();
            resetIdleTimer();
            emitStateIfChanged(true);
          } else {
            log('Failed to refresh JWT on non-Zendesk site, starting basic tracking');
            // Even if refresh fails, start basic tracking
            setupActivityListeners();
            resetIdleTimer();
            startHeartbeat(); // Start heartbeat even without auth
            emitStateIfChanged(true, true);
          }
        };
        setTimeout(tryRefresh, 500);
      } else {
        log('No auth available on non-Zendesk site, starting basic tracking');
        // Track without auth for now - just log activity patterns
        setupActivityListeners();
        resetIdleTimer();

        // Start tracking immediately even without auth
        startHeartbeat(); // Start heartbeat even without auth
        emitStateIfChanged(true, true);

        // Try to get auth from other tabs every 30 seconds
        const tryGetAuth = async () => {
          const stored = lsGet('jwt', null);
          if (stored) {
            const authStatus = loadAuth();
            if (authStatus === true && state.jwt) {
              log('Found auth tokens from another tab, starting full tracking');
              startHeartbeat();
              emitStateIfChanged(true);
            }
          }
        };

        // Check for auth tokens every 30 seconds
        setInterval(tryGetAuth, 30000);
        setTimeout(tryGetAuth, 1000); // Try once immediately
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
  const exposeAPI = () => {
    try {
      // Try regular window first
      window.okSmartAudit = {
    ping: () => sendPing('manual', true),
    bootstrap: bootstrapAuth,  // Exponer bootstrap para debug
    stateInfo: () => ({
      authed: !!state.jwt,
      jwtExpiry: state.jwtExpiry ? new Date(state.jwtExpiry).toISOString() : null,
      refreshExpiry: state.refreshExpiry ? new Date(state.refreshExpiry).toISOString() : null,
      tab: state.tabId,
      zendesk: state.isZendesk,
      currentState: getCurrentState(),
      domain: location.hostname,
      isTracked: isTrackedDomain(),
      category: getDomainCategory(),
      lastActivity: new Date(state.lastActivity).toISOString(),
      lastTicketId: state.lastTicketId,
      lastTicketExpiry: state.lastTicketExpiry ? new Date(state.lastTicketExpiry).toISOString() : null,
      heartbeatActive: !!state.hbTimer,
      lastHeartbeatDomain: state.lastHeartbeatDomain,
      visibility: state.isVisible,
      focus: state.hasFocus,
      lastSentState: state.lastSentState
    }),
    forceSync: () => {
      log('Manual token sync triggered');
      syncTokensFromStorage();
    },
    testPing: async () => {
      const testPayload = {
        ts: new Date().toISOString(),
        jwt: state.jwt || 'no-auth',
        kind: 'test',
        state: getCurrentState(),
        domain: location.hostname,
        path: location.pathname,
        title: document.title || '',
        tab_id: state.tabId,
        ref_ticket_id: currentTicketId(),
        domain_category: getDomainCategory(),
        is_tracked_domain: isTrackedDomain()
      };

      try {
        log('Sending test ping:', testPayload);
        const response = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload),
          credentials: 'omit'
        });

        const result = await response.json();
        log('Test ping result:', response.status, result);
        console.log('Test ping result:', response.status, result);
        return { status: response.status, result };
      } catch (error) {
        log('Test ping error:', error);
        console.error('Test ping error:', error);
        return { error: error.message };
      }
    },
    config: { ...CONFIG, BACKEND_URL: '[redacted]' }
      };

      log('okSmartAudit exposed to window');
    } catch (e) {
      // Try unsafeWindow for sites with strict CSP
      try {
        if (typeof unsafeWindow !== 'undefined') {
          unsafeWindow.okSmartAudit = window.okSmartAudit;
          log('okSmartAudit exposed to unsafeWindow');
        } else {
          log('Failed to expose okSmartAudit API:', e.message);
        }
      } catch (e2) {
        log('Failed to expose okSmartAudit API:', e.message, e2.message);
      }
    }
  };

  // Call exposeAPI after a short delay to ensure DOM is ready
  setTimeout(exposeAPI, 100);

  log('okSmartAudit API setup complete');
})();
