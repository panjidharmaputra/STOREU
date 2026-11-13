/* ═══════════════════════════════════════════════════════════
   STOREU Sound — optional UI sound design (Web Audio synthesis)
   - OFF by default; enabled only via the navbar toggle
   - No audio files, no autoplay, no background music
   - Short, quiet synthesized blips with cooldowns
   - Everything keeps working with sound off or blocked
   ═══════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const STORAGE_KEY = 'storeu_sound_enabled';
    const COOLDOWN_MS = 120; // debounce rapid-fire triggers

    const state = {
        enabled: false,
        ctx: null,
        lastPlay: 0,
    };

    try {
        state.enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) { /* storage unavailable — stay off */ }

    function ensureCtx() {
        if (state.ctx) return state.ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            state.ctx = new AC();
        } catch (e) {
            return null;
        }
        return state.ctx;
    }

    // Synthesize a soft blip: short sine/triangle envelope, low gain
    function blip(freq, durMs, type, gainPeak, whenMs) {
        const ctx = ensureCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        const t0 = ctx.currentTime + (whenMs || 0) / 1000;
        const dur = durMs / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t0);
        // gentle attack + exponential decay → no clicks, no harshness
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(gainPeak || 0.08, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
    }

    const PRESETS = {
        // soft UI click
        click()   { blip(660, 70, 'sine', 0.05); },
        // add to cart: soft two-tone confirm
        add()     { blip(520, 80, 'sine', 0.06); blip(780, 110, 'sine', 0.055, 70); },
        // success: gentle rising triad
        success() { blip(523, 110, 'triangle', 0.05); blip(659, 110, 'triangle', 0.05, 90); blip(784, 170, 'triangle', 0.05, 180); },
        // error: low, muted — distinct but not startling
        error()   { blip(220, 160, 'sine', 0.06); blip(174, 200, 'sine', 0.05, 110); },
    };

    function play(name) {
        if (!state.enabled) return;
        if (!PRESETS[name]) return;
        const now = Date.now();
        if (now - state.lastPlay < COOLDOWN_MS) return; // cooldown
        state.lastPlay = now;
        try {
            PRESETS[name]();
        } catch (e) { /* audio must never break the page */ }
    }

    function setEnabled(on) {
        state.enabled = !!on;
        try {
            localStorage.setItem(STORAGE_KEY, state.enabled ? '1' : '0');
        } catch (e) {}
        // warm up the context on explicit enable (user gesture → autoplay-safe)
        if (state.enabled) ensureCtx();
        syncToggleUI();
    }

    function syncToggleUI() {
        const btn = document.getElementById('sound-toggle');
        if (!btn) return;
        btn.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
        btn.setAttribute('aria-label', state.enabled ? 'Efek suara: aktif' : 'Efek suara: mati');
        btn.title = state.enabled ? 'Efek suara: aktif (klik untuk mematikan)' : 'Efek suara: mati (klik untuk mengaktifkan)';
    }

    function isEnabled() { return state.enabled; }

    // Public API
    window.StoreuSound = { play, setEnabled, isEnabled, syncToggleUI };

    document.addEventListener('DOMContentLoaded', () => {
        syncToggleUI();
        const btn = document.getElementById('sound-toggle');
        if (btn) {
            btn.addEventListener('click', () => {
                const next = !state.enabled;
                setEnabled(next);
                // a tiny confirmation blip when turning ON (user explicitly asked)
                if (next) setTimeout(() => play('click'), 60);
            });
        }
        // Opt-in click sounds on primary CTAs carrying data-sound="click"
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-sound="click"]');
            if (el) play('click');
        });
    });
})();
