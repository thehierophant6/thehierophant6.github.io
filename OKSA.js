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
// @connect      *
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;  // Set to true for detailed logging in development
  const log = (...a) => { if (DEBUG) console.log('[OK Smart Audit]', ...a); };

  log('Script loaded, initializing...');

  // Config
  const CONFIG = {
    BACKEND_URL: 'https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api',
    HEARTBEAT_MS: 60000,         // latido base (60s para menos pings)
    JITTER_MS: 2000,             // ±2s
    // Advanced sessionization config
    READ_GRACE_WEB_MS: 120000,   // 120s para lectura web activa
    READ_GRACE_ZD_MS: 180000,    // 180s para lectura Zendesk
    STATE_STABLE_MS: 5000,       // 5s estabilidad antes de commit
    BG_ENTER_MS: 3000,           // 3s para detectar BG entrada
    BG_EXIT_MS: 1500,            // 1.5s para detectar BG salida
    URL_STABLE_MS: 800,          // 800ms para estabilizar cambios de URL
    OFFLINE_MS: 15 * 60 * 1000,  // 15min punch-out
    SEND_ONLY_AFTER_CLAIM: false,     // true = buffer until user_id; false = send + replay
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
    lastStateEmitAt: 0,
    // Advanced sessionization state
    deviceSessionId: getOrMakeDeviceSessionId(),
    userIP: null,
    lastInputAt: Date.now(),
    focusStable: { value: true, since: Date.now() },
    bgFlag: false,
    urlStable: { href: location.href, since: Date.now() },
    pendingUrlTimer: null,
    currentSegment: null,
    previewSegment: null,
    previewSince: 0,
    lastMarkerHref: null,
    buffer: loadTodayBuffer()
  };

  // Utils
  function genTabId() { return 'tab_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now(); }
  function jitter(ms) { return Math.max(1000, ms + (Math.random() - 0.5) * 2 * CONFIG.JITTER_MS); }
  function isZendesk() { return CONFIG.ZD_HOST_REGEX.test(location.hostname); }
  function lsKey(k) { return CONFIG.STORAGE_PREFIX + k; }
  function lsSet(k, v) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch {} }
  function lsGet(k, d=null) { try { const s = localStorage.getItem(lsKey(k)); return s ? JSON.parse(s) : d; } catch { return d; } }
  function lsDel(k) { try { localStorage.removeItem(lsKey(k)); } catch {} }

  // Advanced sessionization utilities
  function getSiteId(hostname) {
    if (!hostname) return '';
    hostname = hostname.toLowerCase().split(':')[0].replace(/^www\./,'');
    const multi = ['co.uk','org.uk','gov.uk','ac.uk','com.au','net.au','org.au','com.br','com.mx','gob.mx','com.es','org.es','gob.es','edu.es'];
    const p = hostname.split('.');
    if (p.length <= 2) return hostname;
    const last2 = p.slice(-2).join('.');
    const last3 = p.slice(-3).join('.');
    return multi.includes(last2) ? last3 : last2;
  }

  function getOrMakeDeviceSessionId() {
    const k = 'oksa_device_session_id';
    let v = localStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(k, v);
    }
    return v;
  }

  function todayStr() { const d = new Date(); return d.toISOString().slice(0,10); }

  function loadTodayBuffer() {
    const raw = localStorage.getItem('oksa_buf');
    if (!raw) return { day: todayStr(), items: {} };
    let obj = JSON.parse(raw);
    if (obj.day !== todayStr()) obj = { day: todayStr(), items: {} };
    return obj;
  }

  function saveTodayBuffer(o) { localStorage.setItem('oksa_buf', JSON.stringify(o)); }

  function upsertBuf(id, row) {
    state.buffer.items[id] = { ...(state.buffer.items[id] || {}), ...row };
    saveTodayBuffer(state.buffer);
  }

  function getBuf(id) { return state.buffer.items[id]; }

  function makeSegmentId({device_session_id, key, start_ts}) {
    const s = `${device_session_id}|${key.context || 'web'}|${key.site || key.domain || ''}|${key.ticket_id || ''}|${key.attention || 'active'}|${key.bg ? '1' : '0'}|${start_ts}`;
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `seg_${Math.abs(h)}`;
  }

  function isTrackedDomain() {
    // Track ALL domains as requested by user
    const hostname = location.hostname.toLowerCase();
    log('Domain check:', hostname, 'tracked: true (all domains)');
    return true;
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

  function getDomainCategoryFromSite(site) {
    // Get category from normalized site instead of current hostname
    const siteLower = site.toLowerCase();

    if (siteLower.includes('zendesk.com')) return 'WORK';
    if (siteLower.includes('youtube.com') ||
        siteLower.includes('netflix.com') ||
        siteLower.includes('tiktok.com')) return 'ENTERTAINMENT';
    if (siteLower.includes('facebook.com') ||
        siteLower.includes('instagram.com') ||
        siteLower.includes('twitter.com') ||
        siteLower.includes('x.com') ||
        siteLower.includes('whatsapp.com')) return 'SOCIAL';
    if (siteLower.includes('gmail.com') ||
        siteLower.includes('outlook.com')) return 'EMAIL';
    if (siteLower.includes('amazon.com') ||
        siteLower.includes('mercadolibre.com')) return 'SHOPPING';
    if (siteLower.includes('google.com') ||
        siteLower.includes('bing.com')) return 'SEARCH';

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

  // Advanced sessionization: derive state snapshot
  function deriveSnapshot() {
    const now = Date.now();
    const url = new URL(state.urlStable.href);
    const site = getSiteId(url.hostname);
    const context = isZendesk() ? 'zendesk' : 'web';
    const readGrace = (context === 'zendesk') ? CONFIG.READ_GRACE_ZD_MS : CONFIG.READ_GRACE_WEB_MS;

    // attention: ACTIVE if any input in last readGrace; else IDLE
    const attention = (now - state.lastInputAt <= readGrace) ? 'active' : 'idle';

    // bg flag with hysteresis already maintained
    state.bgFlag = !state.focusStable.value;

    // ticket detection for Zendesk - use currentTicketId() to respect TTL
    const ticket_id = (context === 'zendesk') ? currentTicketId() : null;

    return {
      context, attention, bg: state.bgFlag, site, domain: url.hostname,
      ticket_id, href: state.urlStable.href, title: document.title || ''
    };
  }

  function sameKey(a, b) {
    return a && b &&
      a.context === b.context &&
      a.attention === b.attention &&
      a.bg === b.bg &&
      a.site === b.site &&
      (a.ticket_id || null) === (b.ticket_id || null);
  }

  // Segment manager with hysteresis and stability
  function maybeCommitState() {
    const snap = deriveSnapshot();
    const now = Date.now();

    if (!state.previewSegment || !sameKey(state.previewSegment, snap)) {
      state.previewSegment = snap;
      state.previewSince = now;
      return;
    }

    // If the preview has stabilized long enough, commit/switch if needed
    if (!state.currentSegment) {
      if (now - state.previewSince >= CONFIG.STATE_STABLE_MS) {
        startNewSegment(state.previewSegment, now);
      }
      return;
    }

    if (sameKey(state.currentSegment.key, snap)) {
      // extend current
      state.currentSegment.endAt = now;
    } else if (now - state.previewSince >= CONFIG.STATE_STABLE_MS) {
      // switch segments
      closeSegment(state.currentSegment);
      startNewSegment(state.previewSegment, now);
    } else {
      // still stabilizing → keep extending current
      state.currentSegment.endAt = now;
    }
  }

  function startNewSegment(key, ts) {
    const segment_id = makeSegmentId({
      device_session_id: state.deviceSessionId,
      key,
      start_ts: ts
    });

    state.currentSegment = {
      segment_id, key, startAt: ts, endAt: ts, lastBeatAt: 0
    };

    // Send OPEN ping
    sendSegmentPing('open', state.currentSegment);
    log('Started new segment:', key.context, key.attention, key.site);

    // Punch-in marker for first segment of the day
    const today = todayStr();
    const punchInKey = `punch_in_${today}`;
    if (!localStorage.getItem(punchInKey)) {
      sendPingInternal({
        kind: 'manual',  // Use legacy-compatible kind
        segment_id: segment_id,
        device_session_id: state.deviceSessionId,
        user_id: state.userId,
        note_type: 'punch_in',
        ts: new Date(ts).toISOString(),
        jwt: state.jwt || 'no-auth'
      });
      localStorage.setItem(punchInKey, 'true');
      log('Punch-in marker sent for today');
    }

    // Cache for potential replay (if anonymous)
    cacheForReplay(state.currentSegment);
  }

  function closeSegment(seg) {
    if (!seg) return;
    sendSegmentPing('close', seg);
    log('Closed segment:', seg.key.context, seg.key.attention, seg.key.site);
    finalizeInBuffer(seg);
    state.currentSegment = null;
  }

  function cacheForReplay(seg) {
    if (state.userId) return; // no need once identified
    upsertBuf(seg.segment_id, {
      segment_id: seg.segment_id,
      key: seg.key,
      startAt: seg.startAt,
      endAt: seg.endAt,
      user_id: null
    });
  }

  function finalizeInBuffer(seg) {
    if (state.userId) return; // if still anon, keep final endAt for replay
    upsertBuf(seg.segment_id, { ...getBuf(seg.segment_id), endAt: seg.endAt });
  }

  function sendSegmentPing(kind, seg) {
    // Backend-agnostic: if SEND_ONLY_AFTER_CLAIM is true, buffer until user_id is known
    if (CONFIG.SEND_ONLY_AFTER_CLAIM && !state.userId) {
      // Don't send yet, just buffer locally
      cacheForReplay(seg);
      return;
    }

    const duration_sec = Math.max(0, Math.round((seg.endAt - seg.startAt) / 1000));

    // Map to legacy state for backend compatibility
    const legacyState = seg.key.context === 'zendesk'
      ? (seg.key.attention === 'active' ? 'ZTK' : 'IDLE_ZENDESK')
      : (seg.key.attention === 'active' ? 'WEB_ACTIVA' : 'IDLE_WEB');

    // Map new segment kinds to legacy backend-compatible kinds
    const legacyKind = mapSegmentKindToLegacy(kind);

    const payload = {
      ts: new Date().toISOString(),
      jwt: state.jwt || 'no-auth',
      kind: legacyKind,  // Use legacy-compatible kind
      state: legacyState,
      context: seg.key.context,
      attention: seg.key.attention,
      bg: seg.key.bg,
      domain: seg.key.domain,
      site: seg.key.site,
      path: location.pathname,
      title: seg.key.title || '',
      href: seg.key.href,
      tab_id: state.tabId,
      ref_ticket_id: seg.key.ticket_id || currentTicketId(),
      domain_category: getDomainCategoryFromSite(seg.key.site),
      user_ip: state.userIP || 'unknown',
      is_tracked_domain: isTrackedDomain(),
      segment_id: seg.segment_id,
      device_session_id: state.deviceSessionId,
      user_id: state.userId,
      start_ts: new Date(seg.startAt).toISOString(),
      end_ts: new Date(seg.endAt).toISOString(),
      duration_sec,
      duration_min: Math.round(duration_sec / 60)
    };

    // Send ping (reuse existing sendPing logic but with new payload)
    sendPingInternal(payload);
  }

  // Map new segment kinds to legacy backend-compatible kinds
  function mapSegmentKindToLegacy(kind) {
    const kindMap = {
      'open': 'state',    // Segment start = state change
      'beat': 'hb',       // Heartbeat = heartbeat
      'close': 'state',   // Segment end = state change
      'mark': 'manual'    // Markers = manual events
    };
    return kindMap[kind] || kind; // Fallback to original if not mapped
  }

  // Legacy compatibility - map to old getCurrentState for backward compatibility
  function getCurrentState() {
    if (!state.currentSegment) return 'BG'; // fallback

    const key = state.currentSegment.key;
    if (key.bg) return 'BG';
    if (key.context === 'zendesk') return key.attention === 'active' ? 'ZTK' : 'IDLE_ZENDESK';
    return key.attention === 'active' ? 'WEB_ACTIVA' : 'IDLE_WEB';
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
      
      const b = await gmFetch(`${CONFIG.BACKEND_URL}/auth/bootstrap`, {
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
      const r = await gmFetch(`${CONFIG.BACKEND_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.refreshToken })
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

  // --- Helper: GM "fetch" que salta CORS usando GM_xmlhttpRequest ---
  function gmFetch(url, { method = 'GET', headers = {}, body = null, timeout = 15000, _redirects = 0 } = {}) {
    // Detect available GM API (different userscript managers expose it differently)
    const GMXHR = (typeof GM_xmlhttpRequest !== 'undefined')
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
         ? GM.xmlHttpRequest
         : null);

    return new Promise((resolve, reject) => {
      if (!GMXHR) {
        // Fallback a fetch normal si no existe GM (userscript desactivado)
        console.log('[OK Smart Audit] ⚠️ GM not available, using fetch fallback with CORS headers');
        console.log('[OK Smart Audit] 💡 If this fails with CORS, the script is not running as a userscript');

        // Add CORS headers for the fallback
        const corsHeaders = {
          'Content-Type': 'application/json',
          ...headers
        };

        fetch(url, {
          method,
          headers: corsHeaders,
          body,
          credentials: 'omit',
          keepalive: true,
          mode: 'cors'  // Explicitly request CORS mode
        })
          .then(res => res.text().then(t => ({
            ok: res.ok, status: res.status, statusText: res.statusText,
            text: t, json: () => Promise.resolve(t ? JSON.parse(t) : {})
          })))
          .then(resolve)
          .catch(reject);
        return;
      }

      console.log('[OK Smart Audit] ✅ GM available, using GM_xmlhttpRequest');
      console.log('[OK Smart Audit] GM request:', { url, method, headers: Object.keys(headers), body: body ? 'present' : 'none', _redirects });

      GMXHR({
        method,
        url,
        headers,
        data: body,
        timeout,
        onprogress: () => {},
        onload: (r) => {
          try {
            const text = r.responseText || '';
            const status = r.status;
            const statusText = r.statusText || '';
            const resp = {
              ok: status >= 200 && status < 300,
              status,
              statusText,
              text,
              json: () => Promise.resolve(text ? JSON.parse(text) : {})
            };

            console.log('[OK Smart Audit] GM response:', { status, statusText, text: text.substring(0, 100) + '...' });

            // Manejo de redirección manual si cambia de host
            if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && _redirects < 5) {
              const locHeader = (r.responseHeaders || '').split(/\r?\n/).find(h => /^location:/i.test(h));
              const location = locHeader ? locHeader.split(':').slice(1).join(':').trim() : null;
              if (location) {
                console.log('[OK Smart Audit] Redirect', status, '→', location);
                return resolve(gmFetch(location, { method, headers, body, _redirects: _redirects + 1 }));
              }
            }
            resolve(resp);
          } catch (e) {
            console.error('[OK Smart Audit] onload parse error', e, r);
            reject(e);
          }
        },
        onerror: (e) => {
          console.error('[OK Smart Audit] GM onerror', e, { url, method, headers });
          reject(e);
        },
        ontimeout: () => {
          console.error('[OK Smart Audit] GM timeout', { url, method });
          reject(new Error('GM_xmlhttpRequest timeout'));
        },
      });
    });
  }

  // Identity detection and claim functionality
  function detectZendeskAgent() {
    if (!isZendesk()) return null;

    // Try multiple selectors for Zendesk user info
    const selectors = [
      // Modern Zendesk selectors
      '[data-test-id="user-menu"] [data-test-id="user-email"]',
      '[data-test-id="user-menu"] .user-email',
      '[data-test-id="user-info"] .email',
      '[data-test-id="user-info"] [data-test-id="email"]',

      // Legacy selectors
      '.user-info .email',
      '.user-menu .email',
      '.user-profile .email',
      '.dropdown-user .email',

      // Generic selectors
      '.user-email',
      '.email-address',

      // Try to find any element containing @ in Zendesk interface
      '[href*="zendesk.com"]',
      'a[href*="zendesk.com"]'
    ];

    // First try specific selectors for email
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim() || el.getAttribute('href') || '';
        const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          const email = emailMatch[1].toLowerCase();
          const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          log('Detected Zendesk agent via selector:', selector, 'email:', email, 'name:', name);
          return { email, name };
        }
      }
    }

    // Try to detect from user menu text
    const userMenuSelectors = [
      '[data-test-id="user-menu"]',
      '.user-menu',
      '.dropdown-user',
      '.user-profile'
    ];

    for (const selector of userMenuSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent || '';
        // Look for email pattern in menu text
        const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          const email = emailMatch[1].toLowerCase();
          const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          log('Detected Zendesk agent from menu text:', selector, 'email:', email, 'name:', name);
          return { email, name };
        }

        // Try to extract name from menu
        const nameMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)/); // "First Last" pattern
        if (nameMatch && text.length < 100) { // Avoid matching large blocks of text
          const name = nameMatch[1];
          log('Detected Zendesk agent name from menu:', selector, 'name:', name);
          return { email: null, name };
        }
      }
    }

    // Last resort: try to get from document title or meta tags
    const title = document.title || '';
    const emailMatch = title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      const email = emailMatch[1].toLowerCase();
      const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      log('Detected Zendesk agent from title:', 'email:', email, 'name:', name);
      return { email, name };
    }

    log('Could not detect Zendesk agent information');
    return null;
  }

  async function tryClaimIdentity() {
    if (state.userId) return; // already known
    const agent = detectZendeskAgent();
    if (!agent) return;

    // Map to user_id (you'll need to implement this mapping based on your agents.csv)
    const mappedUserId = mapAgentToUserId(agent);
    if (!mappedUserId) return;

    state.userId = mappedUserId;
    log('Identity claimed:', agent.email, '-> user_id:', mappedUserId);

    // Send claim ping to backend with legacy-compatible kind
    sendPingInternal({
      kind: 'manual',  // Map claim to legacy manual
      device_session_id: state.deviceSessionId,
      user_id: state.userId,
      since: new Date(new Date().setHours(0,0,0,0)).toISOString(),
      ts: new Date().toISOString(),
      jwt: state.jwt || 'no-auth'
    });

    // Replay buffered segments with user_id
    replayBufferWithUserId(state.userId);
  }

  function mapAgentToUserId(agent) {
    // Agent mapping based on agents.csv
    // Priority: 1) Exact email match, 2) Name match, 3) Fallback to device session ID
    // This ensures anonymous activity gets properly attributed when user is identified
    //
    // IMPORTANT: Validate these mappings against your Zendesk agent IDs
    // Use okSmartAudit.testAgentDetection() in Zendesk to verify mappings
    const agentsMap = {
      // CS Area
      "carlos.zuleta@okmobility.com": "28412205851293",
      "camila.guerrero@okmobility.com": "27313100569885",
      "david.narvaez@okmobility.com": "19278727185053",
      "diego.caceres@okmobility.com": "28602592993821",
      "jairo.olave@okmobility.com": "22677476560669",
      "linda.lopez@okmobility.com": "28412943512477",
      "santiago.bonilla@okmobility.com": "27313026963485",
      "alexa.marin@okmobility.com": "27313062426397",
      "jhoan.ortiz@okmobility.com": "25910733930909",
      "andres.serna@okmobility.com": "28747968046237",
      "kengy.rangel@okmobility.com": "25468898348829",
      "ketty.calderon@okmobility.com": "24415425168541",
      "marcos.marquines@okmobility.com": "28436277498781",
      "pablo.hurtado@okmobility.com": "28749629487901",
      "vanessa.velasco@okmobility.com": "28752195817885",

      // PT Area
      "alexandra.mezu@okmobility.com": "21153041522973",
      "juan.david.munoz@okmobility.com": "23651660604317",

      // UP Area
      "cristian.david.campo@okmobility.com": "27313182061341",
      "camilo.palacio@okmobility.com": "21153027650461",

      // ATC Area
      "noel.lopez@okmobility.com": "25461977010205",
      "daniela.gaitan@okmobility.com": "25910691932317",
      "ivan.enriquez@okmobility.com": "19540488993565",

      // ResponsablesCC
      "responsablescc@okmobility.com": "7838939114525"
    };

    // Name-based mapping (fallback for cases where email might not match exactly)
    const nameMap = {
      "Carlos Zuleta": "28412205851293",
      "Camila Guerrero": "27313100569885",
      "David Narváez": "19278727185053",
      "Diego Cáceres": "28602592993821",
      "Jairo Olave": "22677476560669",
      "Linda Lopez": "28412943512477",
      "Santiago Bonilla": "27313026963485",
      "Alexa Marín": "27313062426397",
      "Jhoan Ortiz": "25910733930909",
      "Andrés Serna": "28747968046237",
      "Kengy Rangel": "25468898348829",
      "Ketty Calderon": "24415425168541",
      "Marcos Marquines": "28436277498781",
      "Pablo Hurtado": "28749629487901",
      "Vanessa Velasco": "28752195817885",
      "Alexandra Mezu": "21153041522973",
      "Juan David Muñoz": "23651660604317",
      "Cristian David Campo": "27313182061341",
      "Camilo Palacio": "21153027650461",
      "Noel Lopez": "25461977010205",
      "Daniela Gaitan": "25910691932317",
      "Iván Enriquez": "19540488993565",
      "ResponsablesCC": "7838939114525"
    };

    // Try email first
    if (agent.email) {
      const emailKey = agent.email.toLowerCase();
      if (agentsMap[emailKey]) {
        log('Agent mapped by email:', agent.email, '->', agentsMap[emailKey]);
        return agentsMap[emailKey];
      }
    }

    // Try name as fallback
    if (agent.name) {
      if (nameMap[agent.name]) {
        log('Agent mapped by name:', agent.name, '->', nameMap[agent.name]);
        return nameMap[agent.name];
      }
    }

    // If no match found, log and return device session ID as fallback
    log('Agent not found in mapping, using device session ID as fallback:', {
      detectedEmail: agent.email,
      detectedName: agent.name,
      deviceSessionId: state.deviceSessionId
    });

    return state.deviceSessionId;
  }

  function replayBufferWithUserId(userId) {
    const items = Object.values(state.buffer.items || {});
    for (const item of items) {
      // Send replay pings with legacy-compatible kinds
      sendPingInternal({
        kind: 'state',  // Map open to legacy state
        segment_id: item.segment_id,
        device_session_id: state.deviceSessionId,
        user_id: userId,
        context: item.key.context,
        attention: item.key.attention,
        bg: item.key.bg,
        site: item.key.site,
        domain: item.key.domain,
        start_ts: new Date(item.startAt).toISOString(),
        ts: new Date().toISOString(),
        jwt: state.jwt || 'no-auth',
        upsert: true
      });

      sendPingInternal({
        kind: 'state',  // Map close to legacy state
        segment_id: item.segment_id,
        device_session_id: state.deviceSessionId,
        user_id: userId,
        end_ts: new Date(item.endAt).toISOString(),
        ts: new Date().toISOString(),
        jwt: state.jwt || 'no-auth',
        upsert: true
      });
    }

    // Clear buffer after successful replay
    state.buffer = { day: todayStr(), items: {} };
    saveTodayBuffer(state.buffer);
    log('Replayed', items.length, 'buffered segments for user', userId);
  }

  // Input tracking with hysteresis
  function onFocusMaybeChanged() {
    const hasFocus = document.hasFocus() && !document.hidden;
    const now = Date.now();

    if (hasFocus !== state.focusStable.value) {
      const minPersist = hasFocus ? CONFIG.BG_EXIT_MS : CONFIG.BG_ENTER_MS;
      const snapshotAt = now;

      setTimeout(() => {
        if ((document.hasFocus() && !document.hidden) === hasFocus &&
            snapshotAt >= state.focusStable.since) {
          state.focusStable = { value: hasFocus, since: now };
          log('Focus stable changed:', hasFocus);
        }
      }, minPersist);
    }
  }

  // URL stabilization
  function scheduleUrlStableCheck() {
    if (state.pendingUrlTimer) clearTimeout(state.pendingUrlTimer);
    state.pendingUrlTimer = setTimeout(() => {
      if (location.href !== state.urlStable.href) {
        state.urlStable = { href: location.href, since: Date.now() };
        emitPageMarkerIfNeeded();
      }
    }, CONFIG.URL_STABLE_MS);
  }

  function emitPageMarkerIfNeeded() {
    if (!state.currentSegment) return;
    const snap = deriveSnapshot();
    if (snap.site === state.currentSegment.key.site && snap.href !== state.lastMarkerHref) {
      // Send page marker
      sendPingInternal({
        kind: 'manual',  // Use legacy-compatible kind
        segment_id: state.currentSegment.segment_id,
        device_session_id: state.deviceSessionId,
        user_id: state.userId,
        note_type: 'page',
        href: snap.href,
        title: snap.title,
        ts: new Date().toISOString(),
        jwt: state.jwt || 'no-auth'
      });
      state.lastMarkerHref = snap.href;
    }
  }

  // Internal ping sender (replaces direct sendPing calls)
  async function sendPingInternal(payload) {
    try {
      log('Sending segment ping (GM):', payload.kind, payload.state, payload.segment_id);
      const headers = { 'Content-Type': 'application/json' };
      if (state.jwt && state.jwt !== 'no-auth') {
        headers['Authorization'] = `Bearer ${state.jwt}`;
      }

      let r = await gmFetch(`${CONFIG.BACKEND_URL}/activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      log('Segment ping response:', r.status, payload.kind);

      // Handle 401 - JWT expired, try to refresh and retry once
      if (r.status === 401) {
        log('Segment ping 401 - JWT expired, attempting refresh');
        const refreshed = await refreshJWT();
        if (refreshed && state.jwt) {
          log('JWT refreshed successfully, retrying segment ping');
          const headers2 = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.jwt}`
          };
          r = await gmFetch(`${CONFIG.BACKEND_URL}/activity`, {
            method: 'POST',
            headers: headers2,
            body: JSON.stringify({ ...payload, jwt: state.jwt })
          });
          log('Segment ping retry response:', r.status, payload.kind);
        } else {
          log('JWT refresh failed, segment ping will fail');
        }
      }

      if (!r.ok) {
        log('Segment ping failed:', r.status, r.statusText);
        // Log payload for debugging 400 errors
        if (r.status === 400) {
          console.error('[OK Smart Audit] 400 Bad Request payload:', {
            kind: payload.kind,
            state: payload.state,
            segment_id: payload.segment_id,
            url: `${CONFIG.BACKEND_URL}/activity`
          });
        }
      } else {
        log('Segment ping success:', payload.kind, payload.state);
      }
    } catch (err) {
      log('Segment ping error:', err);
    }
  }

  // Envío de pings (usa gmFetch para evitar CORS)
  // Get user's IP address (best effort)
  async function getUserIP() {
    try {
      // Try multiple IP detection services
      const services = [
        'https://api.ipify.org?format=json',
        'https://ipapi.co/json/',
        'https://api.ip.sb/jsonip'
      ];

      for (const service of services) {
        try {
          const response = await gmFetch(service, { timeout: 2000 });
          if (response.ok) {
            const data = await response.json();
            return data.ip || data.query;
          }
        } catch (e) {
          continue; // Try next service
        }
      }

      // Fallback: use a hash of user agent + timezone as pseudo-identifier
      const fallbackId = btoa(navigator.userAgent + Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 16);
      return `fallback_${fallbackId}`;

    } catch (e) {
      // Ultimate fallback
      return `unknown_${Date.now()}`;
    }
  }

  // Legacy sendPing wrapper - routes to new segment system
  async function sendPing(kind = 'hb', force = false, allowWithoutAuth = false) {
    // For legacy compatibility, if we have a current segment, send a beat
    if (state.currentSegment && kind === 'hb') {
      sendSegmentPing('beat', state.currentSegment);
      return;
    }

    // For manual pings or special cases, create a one-off ping
    const payload = {
      ts: new Date().toISOString(),
      jwt: state.jwt || 'no-auth',
      kind,
      state: getCurrentState(),
      domain: location.hostname,
      path: location.pathname,
      title: (document.title || '').slice(0, 140),
      tab_id: state.tabId,
      ref_ticket_id: currentTicketId(),
      domain_category: getDomainCategory(),
      user_ip: state.userIP || 'unknown',
      is_tracked_domain: isTrackedDomain()
    };

    await sendPingInternal(payload);
  }

  // Original sendPing function (renamed to avoid conflicts)
  async function sendPingLegacy(kind = 'hb', force = false, allowWithoutAuth = false) {
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
      user_ip: state.userIP || 'unknown', // IP for user identification
      is_tracked_domain: isTrackedDomain()
    };

    try {
      log('Sending ping (GM):', payload);
      const headers = { 'Content-Type': 'application/json' };
      if (state.jwt && state.jwt !== 'no-auth') {
        headers['Authorization'] = `Bearer ${state.jwt}`;
      }
      const r = await gmFetch(`${CONFIG.BACKEND_URL}/activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
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
          payload.jwt = state.jwt || 'no-auth';
          const retry = await gmFetch(`${CONFIG.BACKEND_URL}/activity`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(state.jwt ? { 'Authorization': `Bearer ${state.jwt}` } : {})
            },
            body: JSON.stringify(payload)
          });
          if (!retry.ok) throw new Error('retry http ' + retry.status);
          log('ping retry success', { kind: payload.kind, st: payload.state, tid: payload.ref_ticket_id });
        } else {
          // Si no hay forma de renovar fuera de Zendesk, no bloqueamos el tracking:
          log('JWT renewal failed; recording as no-auth');
        }
      } else if (!r.ok) {
        throw new Error('http ' + r.status);
      } else {
        log('ping success', { kind: payload.kind, st: payload.state, tid: payload.ref_ticket_id });
        console.log('✅ Ping sent successfully:', {
          kind: payload.kind,
          state: payload.state,
          domain: payload.domain,
          jwt: payload.jwt !== 'no-auth' ? 'authenticated' : 'no-auth',
          status: r.status
        });
      }
    } catch (err) {
      log('ping fail', err);
      console.error('❌ Ping failed:', {
        error: err.message,
        kind: payload.kind,
        state: payload.state,
        domain: payload.domain,
        url: `${CONFIG.BACKEND_URL}/activity`
      });
    }
  }

  // New heartbeat system with segments
  function startHeartbeat() {
    stopHeartbeat();

    // Send heartbeat every HEARTBEAT_MS
    const heartbeatTick = () => {
      if (!amLeader()) return; // only leader tab emits
      if (!state.currentSegment) return;

      const now = Date.now();
      // Send heartbeat to keep presence alive
      sendSegmentPing('beat', state.currentSegment);
      state.currentSegment.lastBeatAt = now;

      state.hbTimer = setTimeout(heartbeatTick, CONFIG.HEARTBEAT_MS);
    };

    // Main state evaluation loop (2x/sec)
    const stateTick = () => {
      maybeCommitState();
      // Continue the loop
      state.stateTickTimer = setTimeout(stateTick, 500);
    };

    // Start both loops
    state.hbTimer = setTimeout(heartbeatTick, CONFIG.HEARTBEAT_MS);
    state.stateTickTimer = setTimeout(stateTick, 500);

    log('Advanced heartbeat started');
  }

  function stopHeartbeat() {
    if (state.hbTimer) {
      clearTimeout(state.hbTimer);
      state.hbTimer = null;
    }
    if (state.stateTickTimer) {
      clearTimeout(state.stateTickTimer);
      state.stateTickTimer = null;
    }
    log('Heartbeat stopped');
  }

  // Optional: single-tab leader for multi-tab scenarios
  function amLeader() {
    const now = Date.now();
    const leaderKey = 'oksa_leader_' + state.deviceSessionId;
    const row = JSON.parse(localStorage.getItem(leaderKey) || '{}');

    if (!row.until || row.until < now) {
      localStorage.setItem(leaderKey, JSON.stringify({
        until: now + CONFIG.HEARTBEAT_MS * 1.2
      }));
      return true;
    }
    return false;
  }

  // Legacy compatibility - kept minimal for backward compatibility
  function emitStateIfChanged(force=false, allowWithoutAuth=false) {
    // Optional: emit legacy state ping for compatibility
    // Comment out if not needed - new engine handles everything
    const cur = getCurrentState();
    if (state.lastSentState !== cur || force) {
      void sendPing('state', force, allowWithoutAuth);
    }
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

  // Enhanced activity tracking with input hysteresis
  function trackActivity() {
    state.lastActivity = Date.now();
    state.lastInputAt = Date.now();
    // The new system handles state changes automatically via maybeCommitState()
  }

  function setupActivityListeners() {
    // Input activity tracking
    ['mousedown','mousemove','keydown','keyup','scroll','touchstart','pointerdown','pointermove','wheel'].forEach(ev =>
      document.addEventListener(ev, trackActivity, { passive: true })
    );

    // Focus/visibility tracking with hysteresis
    document.addEventListener('visibilitychange', onFocusMaybeChanged);
    window.addEventListener('focus', onFocusMaybeChanged);
    window.addEventListener('blur', onFocusMaybeChanged);

    // URL change tracking with stabilization
    window.addEventListener('popstate', scheduleUrlStableCheck);
    window.addEventListener('hashchange', scheduleUrlStableCheck);

    // SPA navigation detection
    const mo = new MutationObserver(() => scheduleUrlStableCheck());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Page unload - close segment cleanly
    window.addEventListener('beforeunload', () => {
      if (state.currentSegment) closeSegment(state.currentSegment);
    });
    window.addEventListener('pagehide', () => {
      if (state.currentSegment) closeSegment(state.currentSegment);
    });

    // Cross-tab token synchronization
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith(CONFIG.STORAGE_PREFIX)) {
        log('localStorage changed in another tab, syncing tokens');
        syncTokensFromStorage();
      }
    });

    // Identity detection timer (for Zendesk)
    if (isZendesk()) {
      setInterval(tryClaimIdentity, 3000);
      // Try immediately
      setTimeout(tryClaimIdentity, 1000);
    }

    // Offline watchdog
    setInterval(() => {
      if (!state.currentSegment) return;
      const now = Date.now();
      const lastAny = Math.max(
        state.currentSegment.endAt,
        state.lastInputAt,
        state.focusStable.since,
        state.urlStable.since
      );
      if (now - lastAny > CONFIG.OFFLINE_MS) {
        log('Offline timeout, sending punch-out and closing segment');

        // Punch-out marker
        sendPingInternal({
          kind: 'manual',  // Use legacy-compatible kind
          segment_id: state.currentSegment.segment_id,
          device_session_id: state.deviceSessionId,
          user_id: state.userId,
          note_type: 'punch_out',
          ts: new Date(now).toISOString(),
          jwt: state.jwt || 'no-auth'
        });

        closeSegment(state.currentSegment);
      }
    }, 10000);

    log('Advanced activity listeners setup');
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

    // Get user IP for activity linking
    try {
      state.userIP = await getUserIP();
      log('User IP detected:', state.userIP);
    } catch (e) {
      log('Failed to get user IP, using fallback');
      state.userIP = `fallback_${Date.now()}`;
    }

    const currentDomain = location.hostname.toLowerCase();
    log('Current domain:', currentDomain, 'zendesk:', state.isZendesk, 'tracking: ALL_DOMAINS');

    // Setup full tracking for ALL domains (as requested by user)

    // Setup activity listeners for tracked domains
    setupActivityListeners();
    setupSPAHooks();

    log('domain:', location.hostname, 'category:', getDomainCategory(), 'tracked:', isTrackedDomain());

    // Clean legacy storage once
    cleanLegacyStorage();

    // Initialize advanced sessionization
    state.isZendesk = isZendesk();
    state.urlStable = { href: location.href, since: Date.now() };

    // Only try bootstrap on Zendesk
    if (state.isZendesk) {
      const authStatus = loadAuth();
      if (authStatus === true) {
        // Valid JWT, start tracking
        updateTicketRef();
        startHeartbeat();
        log('Advanced tracking started with valid JWT');
      } else if (authStatus === 'refresh_needed') {
        // Try to refresh JWT first
        const tryBootstrap = async () => {
          log('attempting bootstrap...');
          const success = await bootstrapAuth();
          if (success && state.jwt) {
            log('bootstrap successful, starting tracking');
            updateTicketRef();
            startHeartbeat();

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
      // Non-Zendesk sites - track activity with new advanced system
      const authStatus = loadAuth();

      if (authStatus === true && state.jwt) {
        log('Non-Zendesk site with valid JWT, starting advanced tracking');
        startHeartbeat();
      } else if (authStatus === 'refresh_needed') {
        log('Non-Zendesk site with refresh token available');
        // Try to refresh for non-Zendesk sites too
        const tryRefresh = async () => {
          const refreshed = await refreshJWT();
          if (refreshed && state.jwt) {
            log('JWT refreshed successfully on non-Zendesk site');
            startHeartbeat();
          } else {
            log('Failed to refresh JWT on non-Zendesk site, starting advanced tracking');
            startHeartbeat(); // Start advanced tracking even without auth
          }
        };
        setTimeout(tryRefresh, 500);
      } else {
        log('No auth available on non-Zendesk site, starting advanced tracking');
        // Start advanced tracking immediately even without auth
        startHeartbeat();

        // Try to get auth from other tabs every 30 seconds
        const tryGetAuth = async () => {
          const stored = lsGet('jwt', null);
          if (stored) {
            const authStatus = loadAuth();
            if (authStatus === true && state.jwt) {
              log('Found auth tokens from another tab, starting full tracking');
              startHeartbeat(); // Will use JWT now
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
      // Expose full API for ALL domains (as requested by user)
      window.okSmartAudit = {
    ping: () => sendPing('manual', true),
    bootstrap: bootstrapAuth,  // Exponer bootstrap para debug
    stateInfo: () => ({
      // Legacy info
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
      visibility: state.isVisible,
      focus: state.hasFocus,
      lastSentState: state.lastSentState,
      // Advanced sessionization info
      deviceSessionId: state.deviceSessionId,
      userId: state.userId,
      userIP: state.userIP,
      currentSegment: state.currentSegment ? {
        segment_id: state.currentSegment.segment_id,
        context: state.currentSegment.key.context,
        attention: state.currentSegment.key.attention,
        site: state.currentSegment.key.site,
        bg: state.currentSegment.key.bg,
        startAt: new Date(state.currentSegment.startAt).toISOString(),
        endAt: new Date(state.currentSegment.endAt).toISOString(),
        duration_min: Math.round((state.currentSegment.endAt - state.currentSegment.startAt) / 60000)
      } : null,
      bufferCount: Object.keys(state.buffer.items || {}).length,
      focusStable: state.focusStable,
      urlStable: state.urlStable,
      lastInputAt: new Date(state.lastInputAt).toISOString(),
      advancedTracking: true
    }),
    forceSync: () => {
      log('Manual token sync triggered');
      syncTokensFromStorage();
    },
    testAgentDetection: () => {
      const agent = detectZendeskAgent();
      if (agent) {
        const userId = mapAgentToUserId(agent);
        console.log('✅ Agent Detection Test:', {
          detected: agent,
          mappedUserId: userId,
          bufferCount: Object.keys(state.buffer.items || {}).length
        });
        return { agent, userId, bufferCount: Object.keys(state.buffer.items || {}).length };
      } else {
        console.log('❌ Agent Detection Test: No agent detected');
        return { agent: null, userId: null };
      }
    },
    testPing: async () => {
      const testPayload = {
        ts: new Date().toISOString(),
        jwt: state.jwt || 'no-auth',
        kind: 'manual',
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
        log('Sending test ping (GM):', testPayload);
        const headers = { 'Content-Type': 'application/json' };
        if (state.jwt && state.jwt !== 'no-auth') {
          headers['Authorization'] = `Bearer ${state.jwt}`;
        }
        const response = await gmFetch(`${CONFIG.BACKEND_URL}/activity`, {
          method: 'POST',
          headers,
          body: JSON.stringify(testPayload)
        });

        const result = await response.json();
        log('Test ping result:', response.status, result);

        if (response.status >= 200 && response.status < 300) {
          console.log('✅ Test ping successful:', {
            status: response.status,
            statusText: response.statusText,
            result,
            url: `${CONFIG.BACKEND_URL}/activity`,
            jwt: state.jwt ? 'present' : 'none',
            domain: location.hostname
          });
        } else {
          console.log('❌ Test ping failed:', {
            status: response.status,
            statusText: response.statusText,
            result,
            url: `${CONFIG.BACKEND_URL}/activity`,
            jwt: state.jwt ? 'present' : 'none',
            domain: location.hostname
          });
        }
        return { status: response.status, result };
      } catch (error) {
        log('Test ping error:', error);
        console.error('❌ Test ping error:', error);
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
