// ==UserScript==
// @name         OK Smart Audit (SAFE)
// @namespace    https://okmobility.com/
// @version      1.1.1
// @description  Activity tracker seguro (carga tardía + alcance limitado)
// @author       OK
// @match        https://okmobility.zendesk.com/agent/*
// @grant        GM_xmlhttpRequest
// @connect      oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Kill-switch
  try { if (localStorage.getItem('ok_smart_audit_safemode') === '1') return; } catch {}

  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log('[OKSA]', ...a); };

  const CONFIG = {
    BACKEND_URL: 'https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api',
    HEARTBEAT_MS: 30000,
    JITTER_MS: 2000,
    IDLE_MS: 60000,
    REF_TICKET_TTL_MS: 7 * 60 * 1000,
    STORAGE_PREFIX: 'ok_smart_audit_',
    STATE_MIN_INTERVAL_MS: 1500
  };

  const state = {
    jwt: null, userId: null, jwtExpiry: 0,
    lastActivity: Date.now(),
    lastTicketId: null, lastTicketExpiry: 0,
    tabId: genTabId(),
    isVisible: !document.hidden,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
    hbTimer: null, idleTimer: null,
    lastSentState: null, lastStateEmitAt: 0
  };

  function genTabId(){ return 'tab_' + Math.random().toString(36).slice(2,11) + '_' + Date.now(); }
  function jitter(ms){ return Math.max(1000, ms + (Math.random()-0.5)*2*CONFIG.JITTER_MS); }
  const lsKey = k => CONFIG.STORAGE_PREFIX + k;
  const lsSet = (k,v) => { try{ localStorage.setItem(lsKey(k), JSON.stringify(v)); }catch{} };
  const lsGet = (k,d=null) => { try{ const s = localStorage.getItem(lsKey(k)); return s?JSON.parse(s):d; }catch{ return d; } };
  const lsDel = k => { try{ localStorage.removeItem(lsKey(k)); }catch{} };

  async function postJSON(url, body) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify(body),
          onload: r => {
            try { resolve({ status: r.status, json: r.responseText ? JSON.parse(r.responseText) : {} }); }
            catch(e){ reject(e); }
          },
          onerror: e => reject(e)
        });
      } else {
        fetch(url, {
          method: 'POST', headers: { 'Content-Type':'application/json' },
          body: JSON.stringify(body), keepalive: true, mode: 'cors', credentials: 'omit'
        }).then(async res => {
          let j={}; try{ j=await res.json(); }catch{}
          resolve({ status: res.status, json: j });
        }).catch(reject);
      }
    });
  }

  function extractTicketId(){
    const m = location.pathname.match(/\/agent\/tickets\/(\d+)/);
    return m ? parseInt(m[1],10) : null;
  }
  function updateTicketRef(){
    const tid = extractTicketId();
    if (tid && tid !== state.lastTicketId){
      state.lastTicketId = tid;
      state.lastTicketExpiry = Date.now() + CONFIG.REF_TICKET_TTL_MS;
      log('ticket ref', tid);
      emitStateIfChanged(true);
    }
  }
  function currentTicketId(){
    return (state.lastTicketId && Date.now() < state.lastTicketExpiry) ? state.lastTicketId : null;
  }

  function getCurrentState(){
    const idle = (Date.now() - state.lastActivity) >= CONFIG.IDLE_MS;
    if (!state.isVisible || !state.hasFocus) return 'BG';
    // estamos en /agent → consideramos Zendesk
    return idle ? 'IDLE_ZENDESK' : 'ZTK';
  }

  function loadAuth(){
    const jwt = lsGet('jwt',null), exp = lsGet('jwtExpiry',0), uid = lsGet('userId',null);
    if (jwt && exp && Date.now() < exp){ state.jwt=jwt; state.jwtExpiry=exp; state.userId=uid; return true; }
    lsDel('jwt'); lsDel('jwtExpiry'); lsDel('userId'); return false;
  }

  async function bootstrapAuth(){
    try{
      const r = await fetch('/api/v2/users/me.json', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('me '+r.status);
      const { user } = await r.json();
      const res = await postJSON(`${CONFIG.BACKEND_URL}/auth/bootstrap`, {
        user_id: user.id, email: user.email, name: user.name
      });
      if (res.status !== 200 || !res.json.jwt) throw new Error('bootstrap '+res.status);
      state.jwt = res.json.jwt;
      state.jwtExpiry = Date.now() + (res.json.ttl_ms || 0);
      state.userId = user.id;
      lsSet('jwt', state.jwt); lsSet('jwtExpiry', state.jwtExpiry); lsSet('userId', state.userId);
      log('bootstrap ok', { uid: user.id });
      return true;
    }catch(e){ log('bootstrap fail', e); return false; }
  }

  async function sendPing(kind='hb', force=false){
    if (!state.jwt || Date.now() >= state.jwtExpiry) return;
    const cur = getCurrentState();
    if (kind==='state' && !force){
      const now = Date.now();
      if (state.lastSentState === cur && (now - state.lastStateEmitAt) < 1500) return;
      state.lastSentState = cur; state.lastStateEmitAt = now;
    }
    const payload = {
      ts: new Date().toISOString(),
      jwt: state.jwt, kind,
      state: cur,
      domain: location.hostname,
      path: location.pathname,
      title: (document.title||'').slice(0,140),
      tab_id: state.tabId,
      ref_ticket_id: currentTicketId()
    };
    try{
      const res = await postJSON(`${CONFIG.BACKEND_URL}/activity`, payload);
      if (res.status !== 200) throw new Error('activity '+res.status);
      log('ping', payload.kind, payload.state, payload.ref_ticket_id);
    }catch(e){ log('ping fail', e); }
  }

  function startHeartbeat(){
    stopHeartbeat();
    const tick = () => { sendPing('hb'); state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS)); };
    state.hbTimer = setTimeout(tick, jitter(CONFIG.HEARTBEAT_MS));
  }
  function stopHeartbeat(){ if (state.hbTimer){ clearTimeout(state.hbTimer); state.hbTimer=null; } }

  function emitStateIfChanged(force=false){
    const cur = getCurrentState();
    if (state.lastSentState !== cur || force) void sendPing('state', force);
  }

  function resetIdleTimer(){
    if (state.idleTimer) clearTimeout(state.idleTimer);
    const due = state.lastActivity + CONFIG.IDLE_MS - Date.now();
    state.idleTimer = setTimeout(() => emitStateIfChanged(true), Math.max(0, due) + 10);
  }

  function trackActivity(){
    state.lastActivity = Date.now();
    resetIdleTimer();
    emitStateIfChanged();
  }

  function setupListeners(){
    ['mousedown','mousemove','keydown','scroll','touchstart','pointerdown','pointermove','wheel']
      .forEach(ev => document.addEventListener(ev, trackActivity, { passive:true }));
    document.addEventListener('visibilitychange', () => { state.isVisible = !document.hidden; emitStateIfChanged(true); });
    window.addEventListener('focus', () => { state.hasFocus = true; emitStateIfChanged(true); });
    window.addEventListener('blur',  () => { state.hasFocus = false; emitStateIfChanged(true); });
    window.addEventListener('beforeunload', () => { sendPing('pagehide', true); });
    window.addEventListener('pagehide',      () => { sendPing('pagehide', true); });
  }

  function setupSPAHooks(){
    try{
      const oPush = history.pushState, oReplace = history.replaceState;
      history.pushState = function(){ oPush.apply(this, arguments); setTimeout(updateTicketRef, 100); };
      history.replaceState = function(){ oReplace.apply(this, arguments); setTimeout(updateTicketRef, 100); };
      window.addEventListener('popstate', () => setTimeout(updateTicketRef, 100));
      const mo = new MutationObserver(() => setTimeout(updateTicketRef, 300));
      if (document.body) mo.observe(document.body, { childList:true, subtree:true });
      else document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList:true, subtree:true }), { once:true });
    }catch(e){ log('SPAHooks fail', e); }
  }

  async function init(){
    try{
      setupListeners();
      setupSPAHooks();
      const have = loadAuth();
      if (!have) await bootstrapAuth();
      if (state.jwt){
        updateTicketRef();
        startHeartbeat();
        resetIdleTimer();
        emitStateIfChanged(true);
      } else {
        log('no auth; no hb');
      }
      log('ready', { authed: !!state.jwt, tab: state.tabId });
      // Exponer helpers de depuración
      window.okSmartAudit = {
        ping: () => sendPing('manual', true),
        bootstrap: () => bootstrapAuth(),
        stateInfo: () => ({ authed: !!state.jwt, tab: state.tabId, state: getCurrentState() })
      };
    }catch(e){
      console.error('[OKSA] init error', e);
    }
  }

  // Carga tardía (evita romper el bootstrap de Zendesk)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    setTimeout(init, 100);
  }
})();
