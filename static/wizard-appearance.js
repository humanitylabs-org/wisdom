/* @wizard/ui Appearance v1 client — vendored copy, to be extracted into @wizard/ui later (wizard-os spec/APPEARANCE.md).
 * WIZARD_APPEARANCE_CLIENT_V1. Framework-neutral; no shell selectors, no shell globals, no data or agent rights.
 *
 * Standalone (plain tab, or an older host): nothing changes; the app paints its own base colours.
 * Hosted (a Wizard shell sent a valid context): writes --wz-* custom properties on <html>, sets
 * html[data-wz-hosted], data-skin, data-presentation (window | immersive) and data-color-scheme, and the app's
 * wizard-appearance.css then makes the canvas transparent so the app sits on the shell's window glass.
 * Accepts only: exact host origin (same origin), source === parent, schema v1, colour-only token values,
 * non-stale revisions. Acknowledges each applied revision. Dispatches `wizard:theme` on window. */
(() => {
  'use strict';
  if (window.WizardTheme) return;
  const root = document.documentElement;
  const NAMES = ['canvas', 'base', 'chrome', 'overlay', 'surface', 'surface-raised', 'text', 'text-secondary', 'text-muted', 'border', 'accent', 'accent-soft', 'on-accent', 'reader-surface'];
  const trustedHost = location.origin; // same-origin hosting today; installed apps get their host origin from the App Manager
  let current = null, connected = false;
  const isColor = v => typeof v === 'string' && v.length > 0 && v.length < 96 && !/[;{}]|url\(/i.test(v) && (!window.CSS || !CSS.supports || CSS.supports('color', v));
  function valid(a) {
    if (!a || a.version !== 1 || !Number.isSafeInteger(a.revision) || a.revision < 0) return false;
    if (!['window', 'immersive'].includes(a.presentation)) return false;
    if (!['dark', 'light'].includes(a.colorScheme) || typeof a.skin !== 'string' || !/^[a-z0-9-]{1,40}$/.test(a.skin)) return false;
    if (!a.tokens || typeof a.tokens !== 'object') return false;
    return NAMES.every(k => isColor(a.tokens[k]));
  }
  function apply(a) {
    if (!valid(a)) return false;
    if (connected && current && a.revision < current.revision) return false; // stale
    for (const k of NAMES) root.style.setProperty('--wz-' + k, a.tokens[k]);
    root.style.colorScheme = a.colorScheme;
    root.dataset.skin = a.skin; root.dataset.presentation = a.presentation; root.dataset.colorScheme = a.colorScheme;
    root.setAttribute('data-wz-hosted', '');
    current = Object.freeze({ version: 1, revision: a.revision, skin: a.skin, colorScheme: a.colorScheme, presentation: a.presentation, tokens: Object.freeze({ ...a.tokens }) });
    connected = true;
    try { dispatchEvent(new CustomEvent('wizard:theme', { detail: current })); } catch (e) {}
    return true;
  }
  root.dataset.presentation = 'standalone';
  addEventListener('message', e => {
    if (parent === window || e.source !== parent || e.origin !== trustedHost || !e.data || e.data.type !== 'wizard:appearance') return;
    if (apply(e.data.appearance)) parent.postMessage({ type: 'wizard:appearance:ack', version: 1, revision: current.revision }, trustedHost);
  });
  window.WizardTheme = { version: 1, get current() { return current; }, get connected() { return connected; } };
  if (parent !== window) { try { parent.postMessage({ type: 'wizard:appearance:ready', version: 1, app: root.dataset.app || '' }, trustedHost); } catch (e) {} }
})();
