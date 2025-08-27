// ==UserScript==
// @name         OK Smart Audit
// @namespace    https://okmobility.com/
// @version      1.0.0
// @description  Activity tracker for Zendesk agents
// @author       OK Mobility
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';
    
    // Configuration constants
    const CONFIG = {
        BACKEND_URL: 'https://oksmartaudit-ajehbzfzdyg4e9hd.westeurope-01.azurewebsites.net/api',
        HEARTBEAT_MS: 30000,  // 30 seconds
        JITTER_MS: 2000,      // ±2 seconds
        IDLE_MS: 60000,       // 60 seconds
        REF_TICKET_TTL_MS: 7 * 60 * 1000,  // 7 minutes
        ZD_HOST_REGEX: /\.zendesk\.com$/,
        STORAGE_PREFIX: 'ok_smart_audit_'
    };
    
    // State management
    let state = {
        jwt: null,
        userId: null,
        lastActivity: Date.now(),
        lastTicketId: null,
        lastTicketExpiry: 0,
        tabId: generateTabId(),
        heartbeatInterval: null,
        isVisible: true,
        hasFocus: true,
        isZendesk: false
    };
    
    // Utility functions
    function generateTabId() {
        return 'tab_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }
    
    function log(message, data = null) {
        console.log(`[OK Smart Audit] ${message}`, data || '');
    }
    
    function getStorageKey(key) {
        return CONFIG.STORAGE_PREFIX + key;
    }
    
    function saveToStorage(key, value) {
        try {
            localStorage.setItem(getStorageKey(key), JSON.stringify(value));
        } catch (e) {
            log('Storage save error:', e);
        }
    }
    
    function loadFromStorage(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(getStorageKey(key));
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            log('Storage load error:', e);
            return defaultValue;
        }
    }
    
    function isZendeskDomain() {
        return CONFIG.ZD_HOST_REGEX.test(window.location.hostname);
    }
    
    function addJitter(baseMs) {
        const jitter = (Math.random() - 0.5) * 2 * CONFIG.JITTER_MS;
        return Math.max(1000, baseMs + jitter);
    }
    
    function getCurrentState() {
        const now = Date.now();
        const timeSinceActivity = now - state.lastActivity;
        const isIdle = timeSinceActivity >= CONFIG.IDLE_MS;
        
        if (!state.isVisible || !state.hasFocus) {
            return 'BG';  // Background/not focused
        }
        
        if (state.isZendesk) {
            return isIdle ? 'IDLE_ZENDESK' : 'ZTK';
        } else {
            return isIdle ? 'IDLE_WEB' : 'WEB_ACTIVA';
        }
    }
    
    function extractTicketId() {
        const path = window.location.pathname;
        const match = path.match(/\/agent\/tickets\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }
    
    function updateTicketReference() {
        const ticketId = extractTicketId();
        if (ticketId && ticketId !== state.lastTicketId) {
            state.lastTicketId = ticketId;
            state.lastTicketExpiry = Date.now() + CONFIG.REF_TICKET_TTL_MS;
            log(`Ticket reference updated: ${ticketId}`);
        }
    }
    
    function getCurrentTicketId() {
        const now = Date.now();
        if (state.lastTicketId && now < state.lastTicketExpiry) {
            return state.lastTicketId;
        }
        return null;
    }
    
    // Authentication functions
    async function bootstrapAuth() {
        if (!isZendeskDomain()) {
            log('Not on Zendesk domain, skipping auth bootstrap');
            return false;
        }
        
        try {
            // Get user info from Zendesk API
            const userResponse = await fetch('/api/v2/users/me.json', {
                credentials: 'same-origin'
            });
            
            if (!userResponse.ok) {
                throw new Error(`Zendesk API error: ${userResponse.status}`);
            }
            
            const userData = await userResponse.json();
            const user = userData.user;
            
            log('Zendesk user data retrieved:', {
                id: user.id,
                email: user.email,
                name: user.name
            });
            
            // Bootstrap JWT with backend
            const bootstrapResponse = await fetch(`${CONFIG.BACKEND_URL}/auth/bootstrap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_id: user.id,
                    email: user.email,
                    name: user.name
                })
            });
            
            if (!bootstrapResponse.ok) {
                throw new Error(`Bootstrap error: ${bootstrapResponse.status}`);
            }
            
            const authData = await bootstrapResponse.json();
            
            state.jwt = authData.jwt;
            state.userId = user.id;
            
            // Save to storage
            saveToStorage('jwt', state.jwt);
            saveToStorage('userId', state.userId);
            saveToStorage('jwtExpiry', Date.now() + authData.ttl_ms);
            
            log('Authentication successful', {
                userId: state.userId,
                ttlMs: authData.ttl_ms
            });
            
            return true;
            
        } catch (error) {
            log('Authentication failed:', error);
            return false;
        }
    }
    
    function loadStoredAuth() {
        const storedJwt = loadFromStorage('jwt');
        const storedUserId = loadFromStorage('userId');
        const jwtExpiry = loadFromStorage('jwtExpiry', 0);
        
        if (storedJwt && storedUserId && Date.now() < jwtExpiry) {
            state.jwt = storedJwt;
            state.userId = storedUserId;
            log('Loaded stored authentication', { userId: state.userId });
            return true;
        }
        
        // Clear expired tokens
        if (storedJwt) {
            localStorage.removeItem(getStorageKey('jwt'));
            localStorage.removeItem(getStorageKey('userId'));
            localStorage.removeItem(getStorageKey('jwtExpiry'));
        }
        
        return false;
    }
    
    // Activity tracking
    async function sendActivityPing(kind = 'hb') {
        if (!state.jwt) {
            log('No JWT available for activity ping');
            return;
        }
        
        const currentState = getCurrentState();
        const ticketId = getCurrentTicketId();
        
        const payload = {
            ts: new Date().toISOString(),
            jwt: state.jwt,
            kind: kind,
            state: currentState,
            domain: window.location.hostname,
            path: window.location.pathname,
            title: document.title.substring(0, 140),
            tab_id: state.tabId,
            ref_ticket_id: ticketId
        };
        
        try {
            // Use sendBeacon if available for better reliability
            if (navigator.sendBeacon) {
                const success = navigator.sendBeacon(
                    `${CONFIG.BACKEND_URL}/activity`,
                    JSON.stringify(payload)
                );
                
                if (success) {
                    log(`Activity ping sent (${kind}):`, {
                        state: currentState,
                        ticketId: ticketId
                    });
                } else {
                    throw new Error('sendBeacon failed');
                }
            } else {
                // Fallback to fetch
                const response = await fetch(`${CONFIG.BACKEND_URL}/activity`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload),
                    keepalive: true
                });
                
                if (response.ok) {
                    log(`Activity ping sent (${kind}):`, {
                        state: currentState,
                        ticketId: ticketId
                    });
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            }
        } catch (error) {
            log('Activity ping failed:', error);
        }
    }
    
    function startHeartbeat() {
        if (state.heartbeatInterval) {
            clearInterval(state.heartbeatInterval);
        }
        
        const sendPing = () => {
            sendActivityPing('hb');
            
            // Schedule next ping with jitter
            const nextInterval = addJitter(CONFIG.HEARTBEAT_MS);
            state.heartbeatInterval = setTimeout(sendPing, nextInterval);
        };
        
        // Start first ping after jittered delay
        const initialDelay = addJitter(CONFIG.HEARTBEAT_MS);
        state.heartbeatInterval = setTimeout(sendPing, initialDelay);
        
        log('Heartbeat started');
    }
    
    function stopHeartbeat() {
        if (state.heartbeatInterval) {
            clearTimeout(state.heartbeatInterval);
            state.heartbeatInterval = null;
            log('Heartbeat stopped');
        }
    }
    
    // Activity detection
    function trackActivity() {
        state.lastActivity = Date.now();
    }
    
    function setupActivityListeners() {
        // Mouse and keyboard activity
        const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
        activityEvents.forEach(event => {
            document.addEventListener(event, trackActivity, { passive: true });
        });
        
        // Page visibility
        document.addEventListener('visibilitychange', () => {
            state.isVisible = !document.hidden;
            log('Visibility changed:', state.isVisible);
        });
        
        // Window focus
        window.addEventListener('focus', () => {
            state.hasFocus = true;
            log('Window focused');
        });
        
        window.addEventListener('blur', () => {
            state.hasFocus = false;
            log('Window blurred');
        });
        
        // Page unload
        window.addEventListener('beforeunload', () => {
            sendActivityPing('pagehide');
        });
        
        window.addEventListener('pagehide', () => {
            sendActivityPing('pagehide');
        });
    }
    
    // SPA navigation detection
    function setupSPAHooks() {
        // History API hooks
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            originalPushState.apply(this, args);
            setTimeout(updateTicketReference, 100);
        };
        
        history.replaceState = function(...args) {
            originalReplaceState.apply(this, args);
            setTimeout(updateTicketReference, 100);
        };
        
        window.addEventListener('popstate', () => {
            setTimeout(updateTicketReference, 100);
        });
        
        // MutationObserver for DOM changes
        if (isZendeskDomain()) {
            const observer = new MutationObserver((mutations) => {
                let urlChanged = false;
                
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        // Check if URL-related elements changed
                        const hasUrlChange = Array.from(mutation.addedNodes).some(node => 
                            node.nodeType === Node.ELEMENT_NODE && 
                            (node.querySelector && node.querySelector('[data-test-id="ticket-pane"]'))
                        );
                        
                        if (hasUrlChange) {
                            urlChanged = true;
                        }
                    }
                });
                
                if (urlChanged) {
                    setTimeout(updateTicketReference, 500);
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            log('SPA hooks installed');
        }
    }
    
    // Initialization
    async function initialize() {
        log('Initializing OK Smart Audit...');
        
        // Set domain flag
        state.isZendesk = isZendeskDomain();
        
        // Setup activity tracking
        setupActivityListeners();
        setupSPAHooks();
        
        // Try to load stored authentication
        if (!loadStoredAuth()) {
            // Bootstrap authentication if on Zendesk
            if (state.isZendesk) {
                await bootstrapAuth();
            }
        }
        
        // Start heartbeat if authenticated
        if (state.jwt) {
            updateTicketReference();
            startHeartbeat();
        } else {
            log('No authentication available, heartbeat not started');
        }
        
        log('OK Smart Audit initialized', {
            isZendesk: state.isZendesk,
            authenticated: !!state.jwt,
            tabId: state.tabId
        });
    }
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        // DOM already loaded
        setTimeout(initialize, 100);
    }
    
    // Expose some functions for debugging
    window.okSmartAudit = {
        getState: () => ({ ...state }),
        getCurrentState,
        sendPing: () => sendActivityPing('manual'),
        bootstrap: bootstrapAuth,
        config: CONFIG
    };
    
})();
