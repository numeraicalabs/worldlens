/**
 * 30_theme.js — Dark/Light theme toggle for WorldLens v20
 *
 * - Reads saved preference from localStorage
 * - Defaults to 'dark'
 * - Injects a toggle button into the nav bar
 * - Applies data-theme attribute on <html>
 * - Emits 'wl:themechange' event for listeners
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'wl-theme';
  var DEFAULT_THEME = 'dark';

  function getTheme() {
    try {
      var t = localStorage.getItem(STORAGE_KEY);
      return (t === 'light' || t === 'dark') ? t : DEFAULT_THEME;
    } catch (e) {
      return DEFAULT_THEME;
    }
  }

  function setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
    updateToggleUI(theme);
    try {
      window.dispatchEvent(new CustomEvent('wl:themechange', { detail: { theme: theme } }));
    } catch (e) { /* old browsers */ }
  }

  function updateToggleUI(theme) {
    document.querySelectorAll('.fire-theme-toggle-opt').forEach(function (el) {
      el.classList.toggle('active', el.dataset.theme === theme);
    });
  }

  function buildToggle() {
    // Prevent duplicate injection
    if (document.getElementById('fire-theme-toggle')) return;

    var wrap = document.createElement('div');
    wrap.id = 'fire-theme-toggle';
    wrap.className = 'fire-theme-toggle';
    wrap.innerHTML =
      '<button class="fire-theme-toggle-opt dark" data-theme="dark" title="Dark theme">' +
        '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M13 9.2A5 5 0 0 1 6.8 3a5 5 0 1 0 6.2 6.2Z"/>' +
        '</svg>' +
        'DARK' +
      '</button>' +
      '<button class="fire-theme-toggle-opt light" data-theme="light" title="Light theme">' +
        '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<circle cx="8" cy="8" r="3"/>' +
          '<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/>' +
        '</svg>' +
        'LIGHT' +
      '</button>';

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.fire-theme-toggle-opt');
      if (btn && btn.dataset.theme) setTheme(btn.dataset.theme);
    });

    // Insert before the Sign Out button in the nav
    var nav = document.querySelector('nav#nav');
    if (!nav) return;
    var signOut = nav.querySelector('button[onclick*="logout"]');
    if (signOut && signOut.parentNode) {
      signOut.parentNode.insertBefore(wrap, signOut);
    } else {
      // Fallback: append to nav
      nav.appendChild(wrap);
    }
  }

  // Apply theme immediately (before DOMContentLoaded to avoid FOUC)
  setTheme(getTheme());

  function init() {
    buildToggle();
    updateToggleUI(getTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.wlTheme = { get: getTheme, set: setTheme };
})();
