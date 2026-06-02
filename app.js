// === Initialize Lucide icons ===
lucide.createIcons();

// === API Configuration ===
var LOCAL_SERVER = 'http://localhost:9999';
var API_URL = LOCAL_SERVER + '/api/categories'; // proxied via server.py (credentials injected server-side)

// Map API category_id → screen key
var CATEGORY_SCREEN_MAP = {
  '1': 'tickets',    // Канатная дорога
  '2': 'alpaka',     // Парк Альпак
  '3': 'museum',     // Музей иллюзий
  '4': 'skypark'     // Skypark
};

var loadedCategories = [];
var dayTypesCalendar = []; // calendar of day types for 100 days ahead

// === Auto-translate API text via MyMemory (free, no key) ===
var TRANSLATE_LANGMAP = { en: 'ru|en', ar: 'ru|ar', zh: 'ru|zh-CN' };

function translateText(text, targetLang, callback) {
  if (!text || targetLang === 'ru') { callback(text); return; }
  var pair = TRANSLATE_LANGMAP[targetLang];
  if (!pair) { callback(text); return; }

  // Check localStorage cache
  var cacheKey = 'tr_' + targetLang + '_' + hashCode(text);
  var cached = localStorage.getItem(cacheKey);
  if (cached) { callback(cached); return; }

  var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + pair;
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.timeout = 8000;
  xhr.onload = function() {
    try {
      var data = JSON.parse(xhr.responseText);
      if (data.responseStatus === 200 && data.responseData && data.responseData.translatedText) {
        var translated = data.responseData.translatedText;
        localStorage.setItem(cacheKey, translated);
        callback(translated);
        return;
      }
    } catch (e) { console.error('[Translate] Parse error:', e); }
    callback(text);
  };
  xhr.onerror = function() { callback(text); };
  xhr.ontimeout = function() { callback(text); };
  xhr.send();
}

function hashCode(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

// Get today's tariff day_type from the calendar
function getTodayDayType() {
  var today = new Date();
  var yyyy = today.getFullYear();
  var mm = String(today.getMonth() + 1).padStart(2, '0');
  var dd = String(today.getDate()).padStart(2, '0');
  var todayStr = yyyy + '-' + mm + '-' + dd;

  for (var i = 0; i < dayTypesCalendar.length; i++) {
    if (dayTypesCalendar[i].date === todayStr) {
      var calType = dayTypesCalendar[i].type;
      // Map calendar type → tariff day_type
      if (calType === 'working') return 'weekday';
      return calType; // 'weekend', 'holiday' match as-is
    }
  }
  return null; // not found in calendar
}

// Banner images per category screen (prefix-based)
var SCREEN_BANNERS = {
  'tickets':  ['images/banner/kd_01.jpeg','images/banner/kd_02.jpg','images/banner/kd_03.jpg','images/banner/kd_04.webp'],
  'alpaka':   ['images/banner/pa_01.jpeg','images/banner/pa_02.png','images/banner/pa_03.jpg','images/banner/pa_04.jpeg'],
  'museum':   ['images/banner/mi_01.webp','images/banner/mi_02.webp','images/banner/mi_03.webp'],
  'skypark':  ['images/banner/zp_01.jpg','images/banner/zp_02.jpg','images/banner/zp_03.jpg','images/banner/zp_04.jpg']
};

function loadCategories() {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', API_URL, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.timeout = 10000;
  xhr.onload = function() {
    try {
      var data = JSON.parse(xhr.responseText);
      // Save day types calendar (overwrite each time)
      if (data.day_types_calendar && data.day_types_calendar.length > 0) {
        dayTypesCalendar = data.day_types_calendar;
        console.log('[API] Loaded day_types_calendar: ' + dayTypesCalendar.length + ' days, today=' + getTodayDayType());
      }
      if (data.categories && data.categories.length > 0) {
        loadedCategories = data.categories;
        renderCategories(data.categories);
        console.log('[API] Loaded ' + data.categories.length + ' categories');
      }
    } catch (e) {
      console.error('[API] Parse error:', e);
    }
  };
  xhr.onerror = function() { console.error('[API] Network error'); };
  xhr.ontimeout = function() { console.error('[API] Timeout'); };
  xhr.send('{}'); // credentials injected by server.py
}

function renderCategories(categories) {
  categories.forEach(function(cat) {
    var screenKey = CATEGORY_SCREEN_MAP[cat.category_id];
    if (!screenKey) return;
    var screenId = 'screen-' + screenKey;
    var screen = document.getElementById(screenId);
    if (!screen) return;

    // Update title
    var titleEl = screen.querySelector('.tkt-title');
    if (titleEl && cat.category_name) titleEl.textContent = cat.category_name;

    // Update description (preserve line breaks from API)
    var descEl = screen.querySelector('.tkt-description p');
    if (descEl && cat.category_description) {
      var safe = cat.category_description
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\r\n/g, '<br>').replace(/\n/g, '<br>').replace(/\r/g, '<br>');
      descEl.innerHTML = safe;
    }

    // Render tariffs (filtered by today's day type)
    var rowsContainer = screen.querySelector('.tkt-rows');
    if (!rowsContainer) return;
    rowsContainer.innerHTML = '';

    var tariffs = cat.category_tariffs || [];
    var todayType = getTodayDayType();
    var filteredTariffs = tariffs;
    if (todayType && tariffs.length > 0) {
      filteredTariffs = tariffs.filter(function(t) {
        return t.day_type === todayType;
      });
    }

    if (filteredTariffs.length === 0) {
      // No tariffs — show unavailable message
      var msg = document.createElement('div');
      msg.className = 'tkt-unavailable';
      msg.setAttribute('data-i18n', 'tickets.unavailable');
      msg.textContent = t('tickets.unavailable');
      rowsContainer.appendChild(msg);
      // Hide pay button
      var payBtn = screen.querySelector('.tkt-pay-btn');
      if (payBtn) payBtn.style.display = 'none';
    } else {
      // Show pay button
      var payBtn = screen.querySelector('.tkt-pay-btn');
      if (payBtn) payBtn.style.display = '';

      filteredTariffs.forEach(function(tariff) {
        var row = document.createElement('div');
        row.className = 'tkt-row';
        row.dataset.price = tariff.price;
        row.dataset.tariffId = tariff.id;
        row.dataset.categoryId = cat.category_id;
        row.dataset.dayType = tariff.day_type || '';
        row.dataset.age = tariff.age || '';
        row.innerHTML =
          '<span class="tkt-pill">' + tariff.name + '</span>' +
          '<span class="tkt-price">' + formatPrice(parseInt(tariff.price)) + ' ₽</span>' +
          '<div class="tkt-counter">' +
            '<button class="tkt-counter-btn tkt-counter-btn--minus" onclick="changeQty(this, -1)">−</button>' +
            '<span class="tkt-counter-val">0</span>' +
            '<button class="tkt-counter-btn tkt-counter-btn--plus" onclick="changeQty(this, 1)">+</button>' +
          '</div>';
        rowsContainer.appendChild(row);
      });
    }
  });

  lucide.createIcons();
  // Re-apply translations after dynamic content is rendered
  if (window.i18n) {
    i18n.applyTranslations();
  }
}

function translateApiContent(categories) {
  var lang = window.i18n ? i18n.getCurrentLang() : 'ru';
  if (lang === 'ru') return;

  categories.forEach(function(cat) {
    var screenKey = CATEGORY_SCREEN_MAP[cat.category_id];
    if (!screenKey) return;
    var screen = document.getElementById('screen-' + screenKey);
    if (!screen) return;

    // Collect all texts to translate in one batch: name + tariff names
    // (descriptions handled separately due to length)
    var shortTexts = [];
    var shortTargets = []; // { el, type }

    // Category name
    var titleEl = screen.querySelector('.tkt-title');
    if (titleEl && cat.category_name) {
      shortTexts.push(cat.category_name);
      shortTargets.push({ el: titleEl, type: 'text' });
    }

    // Tariff names (from original API data, not DOM)
    var tariffs = cat.category_tariffs || [];
    var todayType = getTodayDayType();
    var filtered = tariffs;
    if (todayType && tariffs.length > 0) {
      filtered = tariffs.filter(function(t) { return t.day_type === todayType; });
    }
    var pills = screen.querySelectorAll('.tkt-row .tkt-pill');
    filtered.forEach(function(tariff, i) {
      if (tariff.name && pills[i]) {
        shortTexts.push(tariff.name);
        shortTargets.push({ el: pills[i], type: 'text' });
      }
    });

    // Batch translate short texts (join with separator, split after)
    if (shortTexts.length > 0) {
      var SEP = ' ||| ';
      var joined = shortTexts.join(SEP);
      translateText(joined, lang, function(translated) {
        var parts = translated.split(/\s*\|\|\|\s*/);
        for (var i = 0; i < shortTargets.length; i++) {
          if (parts[i]) shortTargets[i].el.textContent = parts[i].trim();
        }
      });
    }

    // Translate description separately (can be long)
    var descEl = screen.querySelector('.tkt-description p');
    if (descEl && cat.category_description) {
      // Strip \r\n for translation, restore <br> after
      var plain = cat.category_description.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      translateText(plain, lang, function(translated) {
        var safe = translated
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        descEl.innerHTML = safe;
      });
    }
  });
}

// Populate ticket screen carousels from SCREEN_BANNERS (runs immediately, no API needed)
function populateScreenBanners() {
  Object.keys(SCREEN_BANNERS).forEach(function(screenKey) {
    var screenId = 'screen-' + screenKey;
    var screen = document.getElementById(screenId);
    if (!screen) return;
    var track = screen.querySelector('.tkt-carousel-track');
    if (!track) return;
    var banners = SCREEN_BANNERS[screenKey];
    track.innerHTML = '';
    banners.forEach(function(src) {
      var img = document.createElement('img');
      img.src = src;
      img.alt = screenKey;
      img.className = 'tkt-carousel-slide';
      track.appendChild(img);
    });
  });
  initTicketCarousels();
}
// Load categories on startup (banners populated later after all code is defined)
loadCategories();

// Schedule daily reload at 23:55 (update ticket types for next day)
(function scheduleDailyReload() {
  var now = new Date();
  var target = new Date(now);
  target.setHours(23, 55, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  var delay = target - now;
  setTimeout(function() {
    console.log('[API] Daily reload at 23:55');
    loadCategories();
    scheduleDailyReload();
  }, delay);
  console.log('[API] Next daily reload in ' + Math.round(delay / 60000) + ' min');
})();

// === Navigation ===
const screenMap = {
  'splash': 'screen-splash',
  'main': 'screen-main',
  'scan-card': 'screen-scan-card',
  'topup': 'screen-topup',
  'tickets': 'screen-tickets',
  'alpaka': 'screen-alpaka',
  'museum': 'screen-museum',
  'skypark': 'screen-skypark',
  'rental': 'screen-rental',
  'instructors': 'screen-instructors',
  'payment': 'screen-payment',
  'sbp': 'screen-sbp',
  'success': 'screen-success'
};

function navigateTo(screenName) {
  const targetId = screenMap[screenName];
  if (!targetId) return;

  document.querySelectorAll('.screen.active').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.add('active');
    target.querySelectorAll('.main-content, .topup-wrap, .tkt-scroll, .tkt-card, .rent-content, .instructors-content')
      .forEach(el => el.scrollTop = 0);
  }

  // Reset ticket/rental counters when navigating to those screens
  if (screenName === 'tickets') resetTickets();
  if (screenName === 'alpaka') resetScreen('screen-alpaka', 'alpaka-total');
  if (screenName === 'museum') resetScreen('screen-museum', 'museum-total');
  if (screenName === 'skypark') resetScreen('screen-skypark', 'skypark-total');
  if (screenName === 'rental') resetRental();

  // Reset language to Russian when returning to splash
  if (screenName === 'splash' && window.i18n && i18n.getCurrentLang() !== 'ru') {
    setLanguage('ru');
  }
}

function resetTickets() {
  document.querySelectorAll('#screen-tickets .tkt-row').forEach(function(row) {
    row.classList.remove('tkt-row--selected');
    var val = row.querySelector('.tkt-counter-val');
    if (val) val.textContent = '0';
  });
  var comboVal = document.querySelector('.tkt-combo-counter-val');
  if (comboVal) comboVal.textContent = '0';
  var totalEl = document.getElementById('tickets-total');
  if (totalEl) totalEl.textContent = '0 ₽';
}

function resetRental() {
  document.querySelectorAll('#screen-rental .rent-qty-row').forEach(function(row) {
    row.classList.remove('rent-qty-row--selected');
    var val = row.querySelector('.rent-counter-val');
    if (val) val.textContent = '0';
  });
  var totalEl = document.getElementById('rental-total');
  if (totalEl) totalEl.textContent = '0 ₽';
}

function resetScreen(screenId, totalId) {
  document.querySelectorAll('#' + screenId + ' .tkt-row').forEach(function(row) {
    row.classList.remove('tkt-row--selected');
    var val = row.querySelector('.tkt-counter-val');
    if (val) val.textContent = '0';
  });
  var totalEl = document.getElementById(totalId);
  if (totalEl) totalEl.textContent = '0 ₽';
}

// === Toast/Alert ===
let toastTimer = null;
function showAlert(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

// === Tab switching ===
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  const tabs = tab.parentElement;
  tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
});

// === Price selection (topup) ===
function selectPrice(el, price) {
  const card = el.closest('.topup-card');
  card.querySelectorAll('.topup-price-cell').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

// === Ticket quantity ===
function changeQty(btn, delta) {
  const counter = btn.closest('.tkt-counter');
  const valueEl = counter.querySelector('.tkt-counter-val');
  const row = btn.closest('.tkt-row');
  let val = parseInt(valueEl.textContent) + delta;
  if (val < 0) val = 0;
  valueEl.textContent = val;

  if (val > 0) {
    row.classList.add('tkt-row--selected');
  } else {
    row.classList.remove('tkt-row--selected');
  }

  updateTicketsTotal();
}

function updateTicketsTotal() {
  // Find currently active ticket screen
  var screens = [
    { id: 'screen-tickets', totalId: 'tickets-total', hasCombo: true },
    { id: 'screen-alpaka', totalId: 'alpaka-total', hasCombo: false },
    { id: 'screen-museum', totalId: 'museum-total', hasCombo: false },
    { id: 'screen-skypark', totalId: 'skypark-total', hasCombo: false }
  ];

  for (var s = 0; s < screens.length; s++) {
    var screen = document.getElementById(screens[s].id);
    if (!screen || !screen.classList.contains('active')) continue;

    var rows = screen.querySelectorAll('.tkt-row');
    var total = 0;
    rows.forEach(function(row) {
      var price = parseInt(row.dataset.price);
      var qty = parseInt(row.querySelector('.tkt-counter-val').textContent);
      total += price * qty;
    });

    if (screens[s].hasCombo) {
      var comboVal = document.querySelector('.tkt-combo-counter-val');
      if (comboVal) total += parseInt(comboVal.textContent) * 4500;
    }

    var el = document.getElementById(screens[s].totalId);
    if (el) el.textContent = total > 0 ? formatPrice(total) + ' ₽' : '0 ₽';
    break;
  }
}

// === Combo quantity ===
function changeComboQty(btn, delta) {
  const valEl = btn.closest('.tkt-combo-counter').querySelector('.tkt-combo-counter-val');
  let val = parseInt(valEl.textContent) + delta;
  if (val < 0) val = 0;
  valEl.textContent = val;
  updateTicketsTotal();
}

// === Rental quantity ===
function changeRentalQty(btn, delta) {
  const counter = btn.closest('.rent-counter');
  const valueEl = counter.querySelector('.rent-counter-val');
  const row = btn.closest('.rent-qty-row');
  let val = parseInt(valueEl.textContent) + delta;
  if (val < 0) val = 0;
  valueEl.textContent = val;

  if (val > 0) {
    row.classList.add('rent-qty-row--selected');
  } else {
    row.classList.remove('rent-qty-row--selected');
  }

  updateRentalTotal();
}

function updateRentalTotal() {
  const rows = document.querySelectorAll('#screen-rental .rent-qty-row');
  let total = 0;
  rows.forEach(row => {
    const priceText = row.querySelector('.rent-qty-price').textContent;
    const price = parseInt(priceText.replace(/\s/g, '').replace('₽', ''));
    const qty = parseInt(row.querySelector('.rent-counter-val').textContent);
    total += price * qty;
  });
  const el = document.getElementById('rental-total');
  if (el) {
    el.textContent = total > 0 ? formatPrice(total) + ' ₽' : '0 ₽';
  }
}

function formatPrice(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// === Ticket Carousels (with auto-rotation) ===
var tktCarouselTimers = [];

function initTicketCarousels() {
  // Clear previous timers
  tktCarouselTimers.forEach(function(t) { clearInterval(t); });
  tktCarouselTimers = [];

  document.querySelectorAll('[data-carousel]').forEach(function(carousel) {
    var track = carousel.querySelector('.tkt-carousel-track');
    var dotsWrap = carousel.querySelector('.tkt-carousel-dots');
    if (!track || !dotsWrap) return;
    var slides = track.querySelectorAll('.tkt-carousel-slide');
    if (slides.length === 0) return;

    dotsWrap.innerHTML = '';
    var current = 0;

    function goTo(idx) {
      current = idx;
      track.scrollTo({ left: idx * track.offsetWidth, behavior: 'smooth' });
      var allDots = dotsWrap.querySelectorAll('.tkt-carousel-dot');
      allDots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
    }

    slides.forEach(function(_, i) {
      var dot = document.createElement('button');
      dot.className = 'tkt-carousel-dot' + (i === 0 ? ' active' : '');
      dot.onclick = function() { goTo(i); };
      dotsWrap.appendChild(dot);
    });

    if (slides.length <= 1) { dotsWrap.style.display = 'none'; return; }
    dotsWrap.style.display = '';

    // Sync dots on manual scroll
    track.addEventListener('scroll', function() {
      var idx = Math.round(track.scrollLeft / track.offsetWidth);
      if (idx !== current) {
        current = idx;
        var allDots = dotsWrap.querySelectorAll('.tkt-carousel-dot');
        allDots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
      }
    });

    // Auto-rotate every 10 seconds
    var timer = setInterval(function() {
      var next = (current + 1) % slides.length;
      goTo(next);
    }, 10000);
    tktCarouselTimers.push(timer);
  });
}
populateScreenBanners();


// === Easter egg (5 taps on weather card) ===
(function() {
  var taps = 0;
  var tapTimer = null;
  var weatherCard = document.getElementById('weather-temp');
  if (!weatherCard) return;
  var card = weatherCard.closest('.info-card');
  if (!card) return;
  card.addEventListener('click', function(e) {
    e.stopPropagation();
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function() { taps = 0; }, 2000);
    if (taps >= 5) {
      taps = 0;
      var egg = document.getElementById('easter-egg');
      if (!egg || egg.classList.contains('visible')) return;
      egg.classList.add('visible');
      setTimeout(function() { egg.classList.remove('visible'); }, 5000);
    }
  });
})();

// === Easter egg: Statham quotes (5 taps on time card) ===
var STATHAM_QUOTES = [
  'Если упал — вставай. Если нет денег — найди деньги.',
  'Работа — не волк. Никто не волк. Только волк — волк.',
  'Запомни: всего одна ошибка — и ты ошибся.',
  'Делай как надо. Как не надо — не делай.',
  'Слово — не воробей. Вообще ничто не воробей, кроме самого воробья.',
  'Если закрыть глаза — становится темно.',
  'В жизни всегда есть две дороги: одна — первая, а другая — вторая.',
  'Кто рано встаёт — тому весь день спать хочется.',
  'Шаг влево, шаг вправо — два шага.',
  'Никогда не сдавайтесь, идите к своей цели! А если будет сложно — сдавайтесь.',
  'Как говорил мой дед: «Я твой дед».',
  'Если тебя незаслуженно обидели — вернись и заслужи.',
  'Жи-ши пиши от души.',
  'Тут — это вам не там.',
  'Марианскую впадину знаешь? Это я упал.',
  'Без подошвы тапочки — это просто тряпочки.',
  'Сила — не в бабках. Ведь бабки — уже старые.',
  'Я живу, как карта ляжет. Ты живёшь, как мамка скажет.',
  'Работа — это не волк. Работа — ворк. А волк — это ходить.',
  'Если в Монголии — монгол, то в Чехии — чехол.',
  'На первый урок можно и опоздать, ведь учиться никогда не поздно.',
  'Если жизнь — это вызов, я перезвоню.',
  'Никогда не откладывай на завтра то, на что можно забить сегодня.',
  'Жизнь — не сахар, в этом вся соль.',
  'Красиво делай — красиво будет.',
  'Единственный, кто тебя поддерживает — твой позвоночник.',
  'Чтобы быть богатым, нужно всего лишь не быть бедным.',
  'Если заблудился в лесу — иди домой.',
  'Я лысый не потому, что у меня нет волос, а потому, что у волос нет меня.',
  'Бессмысленно осмысливать смысл неосмысленными мыслями.',
  'Не спеши, а то успеешь.',
  'Я два раза, два раза не повторяю, повторяю.',
  'Лёг пораньше, встал попозже. Народная мудрость.',
  'Даже если у тебя сейчас в жизни тёмная полоса — помни, что в любой момент она может оказаться взлётной.',
  'Запомните, а то забудете.',
  'Суп из одной рыбы называется уха. А суп из пяти рыб — ухахахахаха.',
  'Тот, кто знает… знает.',
  'Некоторые люди — как муравьи. Всегда какую-то ерунду несут.',
  'Если обидели — не обижайся. Если ударили — не ударяйся.',
  'Иди домой, ты устал.',
  'Если нет — то нет. А если да — то да.',
  'Жизнь нужно прожить так, чтобы голуби, пролетая над твоим памятником, терпели из уважения.',
  'Не рой другому яму — сам упадёшь. Копай бассейн — больше пользы.',
  'Знание — сила. Незнание — тоже сила, но поменьше.',
  'Сколько бы ты ни спал — всё равно хочется.',
  'На вкус и цвет все фломастеры разные.',
  'Лучше синица в руке, чем утка под кроватью.',
  'Тише едешь — меньше ям заметишь.',
  'Не всё то золото, что блестит. Иногда это я.',
  'Молчание — золото. Но попробуй расплатиться им в магазине.',
  'Рыбак рыбака видит издалека. А Стетхэм видит всех.',
  'Один в поле не воин. Но если это я — то воин.'
];
(function() {
  var taps = 0;
  var tapTimer = null;
  var quoteIndex = parseInt(localStorage.getItem('statham_index') || '0');
  var timeCard = document.getElementById('current-time');
  if (!timeCard) return;
  var card = timeCard.closest('.info-card');
  if (!card) return;
  card.addEventListener('click', function(e) {
    e.stopPropagation();
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function() { taps = 0; }, 2000);
    if (taps >= 5) {
      taps = 0;
      var egg = document.getElementById('statham-egg');
      var quoteEl = document.getElementById('statham-egg-quote');
      if (!egg || egg.classList.contains('visible')) return;
      quoteEl.textContent = '«' + STATHAM_QUOTES[quoteIndex % STATHAM_QUOTES.length] + '»';
      quoteIndex++;
      localStorage.setItem('statham_index', String(quoteIndex));
      egg.classList.add('visible');
      setTimeout(function() { egg.classList.remove('visible'); }, 7000);
    }
  });
})();

// === Date & time display (localized) ===
var DATE_LOCALES = { ru: 'ru-RU', en: 'en-US', ar: 'ar-SA', zh: 'zh-CN' };
function updateDateTime() {
  var now = new Date();
  var lang = (window.i18n ? i18n.getCurrentLang() : 'ru');
  var locale = DATE_LOCALES[lang] || 'ru-RU';
  var dateEl = document.getElementById('current-date');
  var weekdayEl = document.getElementById('current-weekday');
  var timeEl = document.getElementById('current-time');
  if (dateEl) dateEl.textContent = now.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  if (weekdayEl) weekdayEl.textContent = now.toLocaleDateString(locale, { weekday: 'long' });
  if (timeEl) timeEl.textContent = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
updateDateTime();
setInterval(updateDateTime, 10000);

// === Weather (Open-Meteo, Воробьёвы горы) ===
function updateWeather() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://api.open-meteo.com/v1/forecast?latitude=55.71&longitude=37.54&current=temperature_2m&timezone=Europe/Moscow', true);
  xhr.timeout = 10000;
  xhr.onload = function() {
    try {
      var data = JSON.parse(xhr.responseText);
      var temp = Math.round(data.current.temperature_2m);
      var sign = temp > 0 ? '+' : '';
      var el = document.getElementById('weather-temp');
      if (el) el.textContent = sign + temp + '°C';
      var splashEl = document.getElementById('splash-weather-temp');
      if (splashEl) splashEl.textContent = sign + temp + '°C';
    } catch (e) { console.error('[WEATHER] Parse error:', e); }
  };
  xhr.onerror = function() { console.error('[WEATHER] Network error'); };
  xhr.send();
}

updateWeather();
setInterval(updateWeather, 600000); // обновлять каждые 10 минут

// === Auto-return to splash after inactivity ===
let inactivityTimer = null;
let inactivityCountdownTimer = null;
const INACTIVITY_TIMEOUT = 20000; // 20 seconds before warning
const INACTIVITY_COUNTDOWN = 10;  // 10 second countdown in modal

let paymentInProgress = false;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  clearInterval(inactivityCountdownTimer);
  hideInactivityModal();
  var splashEl = document.getElementById('screen-splash');
  if (splashEl && splashEl.classList.contains('active')) return;
  if (paymentInProgress) return;
  inactivityTimer = setTimeout(showInactivityModal, INACTIVITY_TIMEOUT);
}

function showInactivityModal() {
  var modal = document.getElementById('inactivity-modal');
  var countEl = document.getElementById('inactivity-countdown');
  if (!modal) return;
  var remaining = INACTIVITY_COUNTDOWN;
  if (countEl) countEl.textContent = remaining;
  modal.classList.add('active');

  clearInterval(inactivityCountdownTimer);
  inactivityCountdownTimer = setInterval(function() {
    remaining--;
    if (countEl) countEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(inactivityCountdownTimer);
      hideInactivityModal();
      clearInterval(countdownInterval);
      clearTimeout(successTimer);
      clearInterval(sbpCountdownInterval);
      clearTimeout(sbpTimer);
      navigateTo('splash');
    }
  }, 1000);
}

function hideInactivityModal() {
  var modal = document.getElementById('inactivity-modal');
  if (modal) modal.classList.remove('active');
}

function dismissInactivity() {
  resetInactivityTimer();
}

function goToSplashNow() {
  clearTimeout(inactivityTimer);
  clearInterval(inactivityCountdownTimer);
  hideInactivityModal();
  clearInterval(countdownInterval);
  clearTimeout(successTimer);
  clearInterval(sbpCountdownInterval);
  clearTimeout(sbpTimer);
  navigateTo('splash');
}

var _inactivityJustDismissed = false;
function handleInactivityDismiss(e) {
  var modal = document.getElementById('inactivity-modal');
  if (modal && modal.classList.contains('active')) {
    if (e.target.closest('.inactivity-btn')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    _inactivityJustDismissed = true;
    resetInactivityTimer();
    setTimeout(function() { _inactivityJustDismissed = false; }, 400);
    return;
  }
  // Block any click that happens right after modal dismiss
  if (_inactivityJustDismissed) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  resetInactivityTimer();
}
document.addEventListener('click', handleInactivityDismiss, true);
document.addEventListener('touchstart', handleInactivityDismiss, true);
document.addEventListener('touchend', function(e) {
  if (_inactivityJustDismissed) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);
resetInactivityTimer();

// === Payment Processing ===
let successTimer = null;
let countdownInterval = null;
let sbpTimer = null;
let sbpCountdownInterval = null;
let paymentSourceScreen = null; // 'tickets' or 'rental'
let pendingCartItems = [];
let pendingCartTotal = 0;
let lastPaymentRRN = '';
let lastPaymentAuthCode = '';
let lastPaymentCardNumber = '';
let paymentAbortController = null;

// Collect selected items from any ticket screen
function collectTicketItems(screenId) {
  const items = [];
  document.querySelectorAll('#' + screenId + ' .tkt-row').forEach(row => {
    const qty = parseInt(row.querySelector('.tkt-counter-val').textContent);
    if (qty > 0) {
      const name = row.querySelector('.tkt-pill').textContent.trim();
      const price = parseInt(row.dataset.price);
      const tariffId = row.dataset.tariffId || null;
      const categoryId = row.dataset.categoryId || null;
      const dayType = row.dataset.dayType || '';
      const age = row.dataset.age || '';
      items.push({ name: name, price: price, qty: qty, tariffId: tariffId, categoryId: categoryId, dayType: dayType, age: age });
    }
  });
  // Combo counter (only on tickets screen)
  if (screenId === 'screen-tickets') {
    const comboVal = document.querySelector('.tkt-combo-counter-val');
    if (comboVal) {
      const qty = parseInt(comboVal.textContent);
      if (qty > 0) {
        items.push({ name: 'Комбо: Канатная дорога + Парк Альпак', price: 4500, qty: qty });
      }
    }
  }
  return items;
}

// Collect selected items from rental screen
function collectRentalItems() {
  const items = [];
  document.querySelectorAll('#screen-rental .rent-qty-row').forEach(row => {
    const qty = parseInt(row.querySelector('.rent-counter-val').textContent);
    if (qty > 0) {
      const name = 'Прокат: ' + row.querySelector('.rent-qty-pill').textContent.trim();
      const price = parseInt(row.dataset.price);
      items.push({ name: name, price: price, qty: qty });
    }
  });
  return items;
}

// Calculate total from items
function calculateTotal(items) {
  return items.reduce(function(sum, item) {
    return sum + item.price * item.qty;
  }, 0);
}

// Step 1: User clicks ОПЛАТИТЬ → collect cart, show payment methods
function processPayment() {
  // Determine which screen is active
  var ticketScreens = ['tickets', 'alpaka', 'museum', 'skypark'];
  paymentSourceScreen = null;
  pendingCartItems = [];

  for (var i = 0; i < ticketScreens.length; i++) {
    var sid = 'screen-' + ticketScreens[i];
    var el = document.getElementById(sid);
    if (el && el.classList.contains('active')) {
      paymentSourceScreen = ticketScreens[i];
      pendingCartItems = collectTicketItems(sid);
      break;
    }
  }

  if (!paymentSourceScreen) {
    var rentalScreen = document.getElementById('screen-rental');
    if (rentalScreen && rentalScreen.classList.contains('active')) {
      paymentSourceScreen = 'rental';
      pendingCartItems = collectRentalItems();
    }
  }

  pendingCartTotal = calculateTotal(pendingCartItems);

  if (pendingCartItems.length === 0 || pendingCartTotal === 0) {
    showAlert(t('alerts.select_item'));
    return;
  }

  // Show total on payment screen
  const payTotalEl = document.getElementById('pay-total-value');
  if (payTotalEl) payTotalEl.textContent = formatPrice(pendingCartTotal) + ' ₽';

  // Populate order summary
  const orderItems = document.getElementById('pay-order-items');
  if (orderItems) {
    orderItems.innerHTML = '';
    pendingCartItems.forEach(function(item) {
      var row = document.createElement('div');
      row.className = 'pay-order-row';
      row.innerHTML = '<div class="pay-order-row-name"><span class="pay-order-dot"></span><span class="pay-order-row-label">' +
        item.name + ' × ' + item.qty + '</span></div><span class="pay-order-row-price">' +
        formatPrice(item.price * item.qty) + ' ₽</span>';
      orderItems.appendChild(row);
    });
  }

  // Navigate to payment screen then immediately start card payment
  navigateTo('payment');
  payByCard();
}

// Back from payment method screen
function goBackFromPayment() {
  hidePaymentLoader();
  if (paymentSourceScreen) {
    navigateTo(paymentSourceScreen);
  } else {
    navigateTo('main');
  }
}

function showPaymentLoader(text, options) {
  var loader = document.getElementById('payment-loader');
  var cardView = document.getElementById('payment-loader-card');
  var genericView = document.getElementById('payment-loader-generic');

  if (options && options.showCard) {
    // Card payment mode: show amount prominently
    if (cardView) cardView.style.display = '';
    if (genericView) genericView.style.display = 'none';

    var amountEl = document.getElementById('payment-loader-amount');
    if (amountEl) amountEl.textContent = formatPrice(options.amount || 0) + ' \u20BD';
  } else {
    // Generic loader mode
    if (cardView) cardView.style.display = 'none';
    if (genericView) genericView.style.display = '';
    var loaderText = genericView ? genericView.querySelector('.payment-loader-text') : null;
    if (loaderText) loaderText.textContent = text || t('pay.processing');
  }

  if (loader) loader.classList.add('active');
}

function hidePaymentLoader() {
  var loader = document.getElementById('payment-loader');
  if (loader) loader.classList.remove('active');
}


// Step 2a: Pay by card (PAX S300 via INPAS DualConnector)
function payByCard() {
  var amountKopecks = pendingCartTotal * 100;
  var orderId = 'VG-' + Date.now().toString(36).toUpperCase();

  // Pause inactivity timer during payment
  paymentInProgress = true;
  clearTimeout(inactivityTimer);
  clearInterval(inactivityCountdownTimer);
  hideInactivityModal();

  // Update status text on payment screen
  var statusText = document.querySelector('.pay-status-text');
  if (statusText) statusText.textContent = t('pay.card_hint');

  // AbortController for 50s timeout (DC timeout is 45s)
  paymentAbortController = new AbortController();
  var timeoutId = setTimeout(function() {
    paymentAbortController.abort();
  }, 50000);

  fetch('http://localhost:5050/api/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: paymentAbortController.signal,
    body: JSON.stringify({ amount: amountKopecks, order_id: orderId })
  })
  .then(function(response) { return response.json(); })
  .then(function(data) {
    clearTimeout(timeoutId);
    paymentInProgress = false;
    if (data.success) {
      lastPaymentRRN = data.rrn || '';
      lastPaymentAuthCode = data.authorization_code || '';
      lastPaymentCardNumber = data.card_number || '';
      completePayment('Банковская карта');
    } else {
      var errorMsg = data.message || data.error || t('alerts.payment_declined');
      showAlert(errorMsg);
      goBackFromPayment();
    }
  })
  .catch(function(err) {
    clearTimeout(timeoutId);
    paymentInProgress = false;
    if (err.name === 'AbortError') {
      showAlert(t('alerts.payment_timeout'));
    } else {
      console.error('[PAY] Error:', err);
      showAlert(t('alerts.connection_error'));
    }
    goBackFromPayment();
  });
}

// Step 2b: Pay by SBP — show QR code
function payBySBP() {
  // Show amount
  const sbpAmountEl = document.getElementById('sbp-amount-value');
  if (sbpAmountEl) sbpAmountEl.textContent = formatPrice(pendingCartTotal) + ' ₽';

  navigateTo('sbp');
  lucide.createIcons();

  // Generate SBP QR code (simulated payment URL)
  var sbpPaymentId = 'AD' + Date.now().toString(36).toUpperCase();
  var sbpUrl = 'https://qr.nspk.ru/' + sbpPaymentId + '?type=02&bank=&sum=' + (pendingCartTotal * 100) + '&cur=RUB&crc=0000';

  var canvas = document.getElementById('sbp-qr-canvas');
  if (canvas) {
    TicketService.renderQRToCanvas(canvas, sbpUrl, 280);
  }

  // Start SBP countdown (120 seconds)
  var remaining = 120;
  var countdownEl = document.getElementById('sbp-countdown');
  if (countdownEl) countdownEl.textContent = remaining;

  clearInterval(sbpCountdownInterval);
  clearTimeout(sbpTimer);

  sbpCountdownInterval = setInterval(function() {
    remaining--;
    if (countdownEl) countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(sbpCountdownInterval);
      showAlert(t('alerts.sbp_timeout'));
      navigateTo('payment');
    }
  }, 1000);

  // Simulate successful payment after 8 seconds (for demo)
  sbpTimer = setTimeout(function() {
    clearInterval(sbpCountdownInterval);
    completePayment('СБП');
  }, 8000);
}

// Cancel SBP payment
function cancelSBP() {
  clearInterval(sbpCountdownInterval);
  clearTimeout(sbpTimer);
  navigateTo('payment');
}

// Step 2c: Free payment — immediate ticket
function payFree() {
  showPaymentLoader('Оформление билетов...');
  setTimeout(function() {
    hidePaymentLoader();
    completePayment('Без оплаты');
  }, 1500);
}

// Step 3: Complete payment — register in Eskimos, create tickets, print
var pendingTickets = [];
var lastPaymentMethod = '';
var lastPaymentCode = '';

function generatePaymentCode() {
  // UUID v4-like unique payment code
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function registerTicketsInEskimos(paymentCode, callback) {
  // Build tickets array for Eskimos API
  var tickets = [];
  for (var i = 0; i < pendingCartItems.length; i++) {
    var item = pendingCartItems[i];
    for (var q = 0; q < item.qty; q++) {
      tickets.push({
        terminal_id: '1',
        category_id: item.categoryId || '1',
        type_id: item.tariffId || '1',
        price: String(item.price),
        day_type: item.dayType || 'weekday',
        age: item.age || 'adult'
      });
    }
  }

  var requestBody = {
    // terminal_code injected by server.py from .env
    transaction: {
      terminal_order_id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      terminal_payment_code: paymentCode,
      sum: String(pendingCartTotal),
      tickets: tickets
    }
  };

  console.log('[ESKIMOS] Creating tickets:', JSON.stringify(requestBody));

  var xhr = new XMLHttpRequest();
  xhr.open('POST', LOCAL_SERVER + '/api/tickets/create', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.timeout = 15000;
  xhr.onload = function() {
    try {
      var data = JSON.parse(xhr.responseText);
      if (data.error) {
        console.error('[ESKIMOS] Error:', data.message);
        callback(null, data.message);
      } else {
        console.log('[ESKIMOS] Tickets created:', data);
        // Extract ticket_codes from response
        var ticketCodes = [];
        if (data.transaction && data.transaction.tickets) {
          data.transaction.tickets.forEach(function(t) {
            if (t.ticket_code) ticketCodes.push(t.ticket_code);
          });
        }
        callback(ticketCodes, null);
      }
    } catch (e) {
      console.error('[ESKIMOS] Parse error:', e);
      callback(null, 'Ошибка обработки ответа');
    }
  };
  xhr.onerror = function() {
    console.error('[ESKIMOS] Network error');
    callback(null, 'Ошибка сети');
  };
  xhr.ontimeout = function() {
    console.error('[ESKIMOS] Timeout');
    callback(null, 'Таймаут сервера');
  };
  xhr.send(JSON.stringify(requestBody));
}

function completePayment(paymentMethod) {
  lastPaymentMethod = paymentMethod;
  pendingTickets = [];

  var paymentCode = generatePaymentCode();
  lastPaymentCode = paymentCode;

  showPrintLoader();

  // Register tickets in Eskimos first, then create and print
  registerTicketsInEskimos(paymentCode, function(ticketCodes, error) {
    if (error) {
      console.warn('[ESKIMOS] Registration failed, printing local tickets:', error);
    }

    // Create one ticket per item unit, using Eskimos ticket_codes for QR
    try {
      var codeIndex = 0;
      for (var i = 0; i < pendingCartItems.length; i++) {
        var item = pendingCartItems[i];
        for (var q = 0; q < item.qty; q++) {
          var singleItem = [{ name: item.name, price: item.price, qty: 1 }];
          var ticket = TicketService.createTicket(singleItem, item.price, paymentMethod);
          // Use Eskimos ticket_code for QR if available
          if (ticketCodes && ticketCodes[codeIndex]) {
            ticket.qrCode = ticketCodes[codeIndex];
          }
          codeIndex++;
          pendingTickets.push(ticket);
        }
      }
    } catch (e) {
      console.error('Ticket creation failed:', e);
      hidePrintLoader();
      showAlert(t('alerts.ticket_error'));
      return;
    }

    // Print tickets, then show success screen
    var printDone = false;
    function onPrintFinished() {
      if (printDone) return;
      printDone = true;
      hidePrintLoader();
      navigateTo('success');
      showReceiptInline();
    }

    printAllTickets(onPrintFinished);
    // Safety: if printing hangs, proceed after 8 seconds
    setTimeout(onPrintFinished, 8000);
  });
}

// === Receipt (inline on success card) ===
function showReceiptInline() {
  var question = document.getElementById('success-receipt-question');
  var buttons = document.getElementById('success-receipt-buttons');
  var emailForm = document.getElementById('success-receipt-email');
  var emailInput = document.getElementById('receipt-email-input');

  if (question) question.style.display = '';
  if (buttons) buttons.style.display = 'flex';
  if (emailForm) emailForm.style.display = 'none';
  if (emailInput) emailInput.value = '';

  startSuccessCountdown();
  lucide.createIcons();
}

function receiptYes() {
  document.getElementById('success-receipt-question').style.display = 'none';
  document.getElementById('success-receipt-email').style.display = 'flex';
  document.getElementById('receipt-email-input').value = '';
  // Pause countdown while typing email
  clearInterval(countdownInterval);
  clearTimeout(successTimer);
}

function receiptNo() {
  goToMainFromSuccess();
}

function receiptBackToButtons() {
  document.getElementById('success-receipt-email').style.display = 'none';
  document.getElementById('success-receipt-question').style.display = '';
  startSuccessCountdown();
}

function receiptSendEmail() {
  var email = document.getElementById('receipt-email-input').value.trim();
  if (!email || email.indexOf('@') === -1 || email.indexOf('.') === -1) {
    showAlert(t('alerts.invalid_email'));
    return;
  }

  // Send receipt via Eskimos API
  var xhr = new XMLHttpRequest();
  xhr.open('POST', LOCAL_SERVER + '/api/tickets/email', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.timeout = 10000;
  xhr.onload = function() {
    console.log('[EMAIL] Sent to ' + email + ', payment_code=' + lastPaymentCode);
  };
  xhr.onerror = function() { console.error('[EMAIL] Network error'); };
  xhr.send(JSON.stringify({
    terminal_payment_code: lastPaymentCode,
    payers_email: email
  }));

  showAlert(t('alerts.receipt_sent', { email: email }));
  goToMainFromSuccess();
}

function goToMainFromSuccess() {
  clearInterval(countdownInterval);
  clearTimeout(successTimer);
  navigateTo('main');
}

// Print tickets one by one with delay between each
function showPrintLoader() {
  var loader = document.getElementById('print-loader');
  var countEl = document.getElementById('print-loader-count');
  if (countEl) countEl.textContent = '';
  if (loader) loader.classList.add('active');
}

function hidePrintLoader() {
  var loader = document.getElementById('print-loader');
  if (loader) loader.classList.remove('active');
}

function printAllTickets(onAllDone) {
  if (pendingTickets.length === 0) {
    if (onAllDone) onAllDone();
    return;
  }

  var total = pendingTickets.length;
  var countEl = document.getElementById('print-loader-count');

  function printNext(index) {
    if (index >= total) {
      var area = document.getElementById('print-area');
      if (area) area.innerHTML = '';
      if (onAllDone) onAllDone();
      return;
    }
    if (countEl) countEl.textContent = (index + 1) + ' ' + t('print.of') + ' ' + total;
    try {
      TicketService.printTicket(pendingTickets[index], function() {
        printNext(index + 1);
      });
    } catch (e) {
      console.error('Ticket print failed:', e);
      printNext(index + 1);
    }
  }

  setTimeout(function() { printNext(0); }, 500);
}

// Success countdown
function startSuccessCountdown() {
  var remaining = 15;
  var countdownEl = document.getElementById('success-countdown');
  if (countdownEl) countdownEl.textContent = remaining;

  clearInterval(countdownInterval);
  clearTimeout(successTimer);

  countdownInterval = setInterval(function() {
    remaining--;
    if (countdownEl) countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);

  successTimer = setTimeout(function() {
    clearInterval(countdownInterval);
    goToMainFromSuccess();
  }, 15000);
}

// === Virtual Keyboard ===
document.addEventListener('click', function(e) {
  var key = e.target.closest('.vkb-key');
  if (!key) return;

  var input = document.getElementById('receipt-email-input');
  if (!input) return;

  var action = key.getAttribute('data-action');
  if (action === 'backspace') {
    input.value = input.value.slice(0, -1);
  } else {
    var ch = key.getAttribute('data-key');
    if (ch) input.value += ch;
  }
});

// === Banner Carousel ===
(function() {
  var track = document.getElementById('banner-track');
  var dotsContainer = document.getElementById('banner-dots');
  if (!track || !dotsContainer) return;

  // Generate slides from banner images
  var bannerImages = [
    'images/banner/kd_01.jpeg',
    'images/banner/kd_02.jpg',
    'images/banner/kd_03.jpg',
    'images/banner/kd_04.webp',
    'images/banner/mi_01.webp',
    'images/banner/mi_02.webp',
    'images/banner/mi_03.webp',
    'images/banner/pa_01.jpeg',
    'images/banner/pa_02.png',
    'images/banner/pa_03.jpg',
    'images/banner/pa_04.jpeg',
    'images/banner/zp_01.jpg',
    'images/banner/zp_02.jpg',
    'images/banner/zp_03.jpg',
    'images/banner/zp_04.jpg'
  ];

  track.innerHTML = '';
  dotsContainer.innerHTML = '';
  bannerImages.forEach(function(src, i) {
    var slide = document.createElement('div');
    slide.className = 'banner';
    slide.innerHTML = '<div class="banner-bg" style="background-image:url(\'' + src + '\')"></div>';
    track.appendChild(slide);

    var dot = document.createElement('span');
    dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
    dotsContainer.appendChild(dot);
  });

  var slides = track.querySelectorAll('.banner');
  var dots = dotsContainer.querySelectorAll('.banner-dot');
  var current = 0;
  var total = slides.length;
  var autoInterval = null;
  var AUTO_DELAY = 5000;

  function goTo(index) {
    if (index < 0) index = total - 1;
    if (index >= total) index = 0;
    current = index;
    track.style.transform = 'translateX(-' + (current * 100) + '%)';
    dots.forEach(function(d, i) {
      d.classList.toggle('active', i === current);
    });
  }

  function startAuto() {
    stopAuto();
    autoInterval = setInterval(function() {
      goTo(current + 1);
    }, AUTO_DELAY);
  }

  function stopAuto() {
    clearInterval(autoInterval);
  }

  // Dot clicks
  dots.forEach(function(dot, i) {
    dot.addEventListener('click', function() {
      goTo(i);
      startAuto();
    });
  });

  // Touch swipe
  var startX = 0;
  var startY = 0;
  var isDragging = false;

  track.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = true;
    stopAuto();
  }, { passive: true });

  track.addEventListener('touchmove', function(e) {
    if (!isDragging) return;
    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;
    // Prevent vertical scroll when swiping horizontally
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      e.preventDefault();
    }
  }, { passive: false });

  track.addEventListener('touchend', function(e) {
    if (!isDragging) return;
    isDragging = false;
    var dx = e.changedTouches[0].clientX - startX;
    if (dx < -50) goTo(current + 1);   // swipe left
    else if (dx > 50) goTo(current - 1); // swipe right
    startAuto();
  }, { passive: true });

  // Mouse drag (for desktop testing)
  track.addEventListener('mousedown', function(e) {
    startX = e.clientX;
    isDragging = true;
    stopAuto();
    e.preventDefault();
  });

  document.addEventListener('mouseup', function(e) {
    if (!isDragging) return;
    isDragging = false;
    var dx = e.clientX - startX;
    if (dx < -50) goTo(current + 1);
    else if (dx > 50) goTo(current - 1);
    startAuto();
  });

  // Start auto-rotation
  startAuto();
})();
