// i18n.js — Internationalization engine for TERMINAL_VG kiosk
(function() {
  'use strict';

  var LANGUAGES = {
    ru: { name: 'Русский',  flag: 'images/flags/ru.svg', dir: 'ltr' },
    en: { name: 'English',  flag: 'images/flags/en.svg', dir: 'ltr' },
    ar: { name: 'العربية',  flag: 'images/flags/ar.svg', dir: 'rtl' },
    zh: { name: '中文',      flag: 'images/flags/zh.svg', dir: 'ltr' }
  };

  var DEFAULT_LANG = 'ru';
  var currentLang = DEFAULT_LANG;
  var translations = {};

  // Load a language JSON file
  function loadLanguage(lang, callback) {
    if (translations[lang]) { if (callback) callback(); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'lang/' + lang + '.json?v=20260330', true);
    xhr.onload = function() {
      try { translations[lang] = JSON.parse(xhr.responseText); }
      catch (e) { console.error('[i18n] Parse error for ' + lang, e); }
      if (callback) callback();
    };
    xhr.onerror = function() {
      console.error('[i18n] Failed to load ' + lang);
      if (callback) callback();
    };
    xhr.send();
  }

  // Get translation by dot-notation key, e.g. t('common.back')
  function t(key, params) {
    var value = resolve(translations[currentLang], key);
    // Fallback to default language
    if (value === undefined && currentLang !== DEFAULT_LANG) {
      value = resolve(translations[DEFAULT_LANG], key);
    }
    if (value === undefined || typeof value === 'object') return key;
    // Replace {param} placeholders
    if (params) {
      Object.keys(params).forEach(function(p) {
        value = value.replace(new RegExp('\\{' + p + '\\}', 'g'), params[p]);
      });
    }
    return value;
  }

  function resolve(obj, path) {
    if (!obj) return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === undefined || cur === null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Apply all translations to DOM elements with data-i18n attributes
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });

    // Set text direction (RTL for Arabic)
    var info = LANGUAGES[currentLang];
    document.documentElement.dir = info ? info.dir : 'ltr';
    document.documentElement.lang = currentLang;

    // Update all flag images in switchers
    var flagSrc = info ? info.flag : LANGUAGES[DEFAULT_LANG].flag;
    document.querySelectorAll('.lang-current-flag').forEach(function(img) {
      img.src = flagSrc;
    });

    console.log('[i18n] Applied: ' + currentLang);
  }

  // Switch language
  function setLanguage(lang) {
    if (!LANGUAGES[lang]) return;
    var dropdown = document.getElementById('lang-dropdown');
    if (dropdown) dropdown.classList.remove('active');
    if (lang === currentLang) return;

    currentLang = lang;
    localStorage.setItem('terminal_lang', lang);

    loadLanguage(lang, function() {
      applyTranslations();
      // Re-render categories from original API data, then translate
      if (window.loadedCategories && window.renderCategories) {
        renderCategories(loadedCategories);
      }
      // Update localized date & time
      if (window.updateDateTime) updateDateTime();
    });
  }

  // Toggle dropdown
  function toggleLangDropdown(e) {
    e.stopPropagation();
    var dropdown = document.getElementById('lang-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('active');

    // Position near the clicked button
    var btn = e.currentTarget;
    var rect = btn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 8) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
  }

  // Close dropdown on outside click
  document.addEventListener('click', function() {
    var dropdown = document.getElementById('lang-dropdown');
    if (dropdown) dropdown.classList.remove('active');
  });

  // Initialize: load saved language or default
  function init() {
    var saved = localStorage.getItem('terminal_lang');
    currentLang = (saved && LANGUAGES[saved]) ? saved : DEFAULT_LANG;

    // Always load default first (for fallbacks), then current
    loadLanguage(DEFAULT_LANG, function() {
      if (currentLang !== DEFAULT_LANG) {
        loadLanguage(currentLang, function() { applyTranslations(); });
      } else {
        applyTranslations();
      }
    });
  }

  // Public API
  window.t = t;
  window.setLanguage = setLanguage;
  window.toggleLangDropdown = toggleLangDropdown;
  window.i18n = {
    t: t,
    setLanguage: setLanguage,
    applyTranslations: applyTranslations,
    getCurrentLang: function() { return currentLang; },
    LANGUAGES: LANGUAGES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
