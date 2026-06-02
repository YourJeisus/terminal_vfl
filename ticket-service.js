// === Ticket Generation Service ===
// Manages ticket creation, sequential numbering, logging, and printing
// for the Vorobyovy Gory kiosk terminal

// Logo URL — dynamic based on current origin (works on Vercel, local, etc.)
function getLogoURL() {
  return window.location.origin + '/images/VG_logo_dark_masked.svg';
}

const TicketService = {
  STORAGE_KEY: 'vg_ticket_log',
  COUNTER_KEY: 'vg_ticket_counter',

  // --- Numbering ---

  getNextNumber() {
    let counter = parseInt(localStorage.getItem(this.COUNTER_KEY) || '0') + 1;
    localStorage.setItem(this.COUNTER_KEY, String(counter));
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return 'VG-' + yy + mm + dd + '-' + String(counter).padStart(6, '0');
  },

  // --- Ticket Creation ---

  createTicket(items, totalPrice, paymentMethod) {
    const now = new Date();
    const date = now.toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }) + ' ' + now.toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit'
    });

    const ticket = {
      number: this.getNextNumber(),
      items: items,
      type: this.formatTicketType(items),
      totalPrice: totalPrice,
      cashier: 'Терминал №1',
      date: date,
      dateISO: now.toISOString(),
      paymentMethod: paymentMethod,
      status: 'sold'
    };

    this.logTicket(ticket);
    return ticket;
  },

  formatTicketType(items) {
    if (items.length === 0) return 'Неизвестный';
    if (items.length === 1 && items[0].qty === 1) {
      return items[0].name;
    }
    return items.map(function(i) {
      return i.name + (i.qty > 1 ? ' x' + i.qty : '');
    }).join(', ');
  },

  // --- Logging ---

  logTicket(ticket) {
    var log = this.getLog();
    log.push(ticket);
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(log));
    } catch (e) {
      // localStorage full — remove oldest entries
      if (log.length > 100) {
        log = log.slice(-100);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(log));
      }
    }

    // Structured console output for monitoring/debugging
    console.log(
      '%c[БИЛЕТ ПРОДАН] %c#' + ticket.number,
      'color: #2ECC71; font-weight: bold; font-size: 14px;',
      'color: #6AAFE6; font-weight: bold; font-size: 14px;'
    );
    console.table({
      'Номер': ticket.number,
      'Тип': ticket.type,
      'Стоимость': this.formatPrice(ticket.totalPrice) + ' ₽',
      'Оплата': ticket.paymentMethod,
      'Кассир': ticket.cashier,
      'Дата': ticket.date,
      'Статус': ticket.status
    });
  },

  getLog() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  },

  getDailySummary() {
    var today = new Date().toLocaleDateString('ru-RU');
    var log = this.getLog();
    var todayTickets = log.filter(function(t) {
      return t.date.indexOf(today) === 0;
    });
    var totalRevenue = todayTickets.reduce(function(sum, t) {
      return sum + t.totalPrice;
    }, 0);
    return {
      date: today,
      count: todayTickets.length,
      revenue: totalRevenue,
      tickets: todayTickets
    };
  },

  printDailySummary() {
    var s = this.getDailySummary();
    console.log(
      '%c[СВОДКА ЗА ' + s.date + ']',
      'color: #FF6B35; font-weight: bold; font-size: 14px;'
    );
    console.log('Билетов продано: ' + s.count);
    console.log('Выручка: ' + this.formatPrice(s.revenue) + ' ₽');
    if (s.tickets.length > 0) {
      console.table(s.tickets.map(function(t) {
        return {
          '№': t.number,
          'Тип': t.type,
          'Сумма': t.totalPrice + ' ₽',
          'Оплата': t.paymentMethod,
          'Время': t.date
        };
      }));
    }
    return s;
  },

  // --- QR Code Generation ---

  generateQRDataURL(data, size) {
    var qr = qrcode(0, 'L');
    qr.addData(data);
    qr.make();

    var moduleCount = qr.getModuleCount();
    var cellSize = Math.floor(size / moduleCount);
    var actualSize = cellSize * moduleCount;

    var canvas = document.createElement('canvas');
    canvas.width = actualSize;
    canvas.height = actualSize;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, actualSize, actualSize);

    ctx.fillStyle = '#000000';
    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return canvas.toDataURL('image/png');
  },

  renderQRToCanvas(canvasEl, data, size) {
    var qr = qrcode(0, 'L');
    qr.addData(data);
    qr.make();

    var moduleCount = qr.getModuleCount();
    var cellSize = Math.floor(size / moduleCount);
    var actualSize = cellSize * moduleCount;

    canvasEl.width = actualSize;
    canvasEl.height = actualSize;
    var ctx = canvasEl.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, actualSize, actualSize);

    ctx.fillStyle = '#000000';
    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
  },

  // --- Ticket Content (for #print-area, styles in styles.css @media print) ---

  generateTicketContent(ticket) {
    var qrCode = ticket.qrCode || ticket.number.replace(/-/g, '');
    var qrBigURL = this.generateQRDataURL(qrCode, 180);
    var price = this.formatPrice(ticket.totalPrice);
    var logoURL = getLogoURL();

    return '<div class="t">' +
      '<img class="logo" src="' + logoURL + '">' +
      '<div class="ln"></div>' +
      '<div class="tw"><div class="tt">Билет</div><div class="tp">' + ticket.type + '</div></div>' +
      '<div class="ln"></div>' +
      '<div class="it">' +
      '<div class="ir"><span class="il">Стоимость</span><span class="iv">' + price + '</span></div>' +
      '<div class="ir"><span class="il">Кассир</span><span class="iv">' + ticket.cashier + '</span></div>' +
      '<div class="ir"><span class="il">Дата</span><span class="iv">' + ticket.date + '</span></div>' +
      '<div class="ir"><span class="il">Номер</span><span class="iv">' + ticket.number + '</span></div>' +
      '</div>' +
      '<div class="ln"></div>' +
      '<div class="ss"><div class="st">Для прохода - отсканируйте этот код:</div>' +
      '<div class="qb"><img src="' + qrBigURL + '"></div></div>' +
      '<div class="ln"></div>' +
      '<div class="ct">+7 (495) 123-82-61</div>' +
      '<div class="ct"><span>srkvg.ru</span></div>' +
      '</div>';
  },

  // --- Print: try local server GDI first, fallback to window.print() ---

  _cachedLogo: null,

  preloadLogo() {
    var img = new Image();
    img.onload = function() { TicketService._cachedLogo = img; };
    img.src = getLogoURL();
  },

  printTicket(ticket, onDone) {
    var self = this;

    // Render ticket to canvas → PNG
    var dataURL = this._renderTicketCanvas(ticket);

    // Try local print server (silent, like PhotoBudka)
    this._printViaServer(dataURL, function(success) {
      if (success) {
        console.log('[PRINT] Sent via server GDI: ' + ticket.number);
        if (onDone) setTimeout(onDone, 500);
      } else {
        // Fallback: window.print() with #print-area
        console.log('[PRINT] Server unavailable, fallback window.print()');
        self._printViaBrowser(self.generateTicketContent(ticket), onDone);
      }
    });
  },

  // Draw entire ticket on Canvas (576px = 80mm at 203 DPI)
  // Design from Pencil: bill_VG.pen → "Ticket Vorobyovy Gory"
  // Scale factor: 576/302 ≈ 1.91
  _renderTicketCanvas(ticket) {
    var W = 576;
    var S = W / 302; // scale from design px to canvas px
    var PAD = Math.floor(20 * S); // 20px padding in design
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = 1100;
    var ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, canvas.height);
    ctx.fillStyle = '#000';

    // Top padding (16px design)
    var y = Math.floor(16 * S);

    // Logo — SVG dark masked, padding top 38px in design
    y += Math.floor(38 * S);
    if (this._cachedLogo) {
      var logo = this._cachedLogo;
      var lw = Math.floor(W * 0.6);
      var lh = Math.floor(lw * (logo.height / logo.width));
      var lx = (W - lw) / 2;
      ctx.drawImage(logo, lx, y, lw, lh);
      y += lh + Math.floor(8 * S);
    }

    // Line 1 (1px design = 2px canvas)
    ctx.fillRect(PAD, y, W - PAD * 2, 2); y += Math.floor(20 * S);

    // Title: "Билет" — Roboto 26px 900
    ctx.font = '900 ' + Math.floor(26 * S) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Билет', W / 2, y + Math.floor(26 * S));
    y += Math.floor(34 * S);

    // Ticket type — Roboto 12px 800
    ctx.font = '800 ' + Math.floor(12 * S) + 'px sans-serif';
    var typeText = ticket.type;
    var maxWidth = W - PAD * 2;
    var words = typeText.split(' ');
    var lines = [];
    var currentLine = words[0];
    for (var w = 1; w < words.length; w++) {
      var testLine = currentLine + ' ' + words[w];
      if (ctx.measureText(testLine).width > maxWidth) {
        lines.push(currentLine);
        currentLine = words[w];
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    for (var l = 0; l < lines.length; l++) {
      ctx.fillText(lines[l], W / 2, y + Math.floor(14 * S));
      y += Math.floor(16 * S);
    }
    y += Math.floor(16 * S);

    // Line 2
    ctx.fillRect(PAD, y, W - PAD * 2, 2); y += Math.floor(16 * S);

    // Data rows — label 700, value 600 (per updated Pencil)
    var rows = [
      ['Стоимость', this.formatPrice(ticket.totalPrice)],
      ['Кассир', ticket.cashier],
      ['Дата', ticket.date],
      ['Номер', ticket.number]
    ];
    var fontSize = Math.floor(12 * S);
    for (var i = 0; i < rows.length; i++) {
      ctx.textAlign = 'left';
      ctx.font = '700 ' + fontSize + 'px sans-serif';
      ctx.fillText(rows[i][0], PAD, y + fontSize);
      ctx.textAlign = 'right';
      ctx.font = '600 ' + fontSize + 'px sans-serif';
      ctx.fillText(rows[i][1], W - PAD, y + fontSize);
      y += Math.floor(18 * S);
    }
    y += Math.floor(4 * S);

    // Line 3
    ctx.fillRect(PAD, y, W - PAD * 2, 2); y += Math.floor(18 * S);

    // Scan text — single line, Roboto 12px 800
    ctx.font = '800 ' + fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Для прохода - отсканируйте этот код:', W / 2, y + fontSize);
    y += Math.floor(36 * S);

    // QR code — use Eskimos ticket_code if available
    var qrCode = ticket.qrCode || ticket.number.replace(/-/g, '');
    var qrSize = Math.floor(160 * S);
    var qr = qrcode(0, 'L');
    qr.addData(qrCode);
    qr.make();
    var mc = qr.getModuleCount();
    var cs = Math.floor(qrSize / mc);
    var qs = cs * mc;
    var qx = (W - qs) / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qx - 4, y - 4, qs + 8, qs + 8);
    ctx.fillStyle = '#000';
    for (var r = 0; r < mc; r++) {
      for (var c = 0; c < mc; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(qx + c * cs, y + r * cs, cs, cs);
        }
      }
    }
    y += qs + Math.floor(12 * S);

    // Line 4 (2px in design)
    ctx.fillRect(PAD, y, W - PAD * 2, Math.floor(2 * S)); y += Math.floor(14 * S);

    // Footer — phone left, site right (space-between in design)
    ctx.font = '800 ' + fontSize + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('+7 (495) 123-82-61', PAD, y + fontSize);
    ctx.textAlign = 'right';
    ctx.fillText('srkvg.ru', W - PAD, y + fontSize);
    y += Math.floor(24 * S);

    // Trim canvas to actual height
    var trimmed = document.createElement('canvas');
    trimmed.width = W;
    trimmed.height = y;
    trimmed.getContext('2d').drawImage(canvas, 0, 0);

    // Rotate 180° for thermal printer orientation
    var rotated = document.createElement('canvas');
    rotated.width = trimmed.width;
    rotated.height = trimmed.height;
    var rctx = rotated.getContext('2d');
    rctx.translate(rotated.width / 2, rotated.height / 2);
    rctx.rotate(Math.PI);
    rctx.drawImage(trimmed, -rotated.width / 2, -rotated.height / 2);

    return rotated.toDataURL('image/png');
  },

  // Send PNG to local print server (Python GDI)
  _printViaServer(dataURL, callback) {
    if (!dataURL) { callback(false); return; }

    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://localhost:9999/print', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 5000;
    xhr.onload = function() {
      try {
        var resp = JSON.parse(xhr.responseText);
        callback(resp.success === true);
      } catch (e) { callback(false); }
    };
    xhr.onerror = function() { callback(false); };
    xhr.ontimeout = function() { callback(false); };
    xhr.send(JSON.stringify({ image: dataURL }));
  },

  // Fallback: window.print() with #print-area
  _printViaBrowser(content, onDone) {
    var area = document.getElementById('print-area');
    if (!area) { if (onDone) onDone(); return; }

    area.innerHTML = content;

    var images = area.querySelectorAll('img');
    var total = images.length;
    var loaded = 0;
    var printed = false;

    function doPrint() {
      if (printed) return;
      printed = true;
      setTimeout(function() {
        if (onDone) {
          var handler = function() {
            window.removeEventListener('afterprint', handler);
            setTimeout(onDone, 300);
          };
          window.addEventListener('afterprint', handler);
        }
        window.print();
      }, 300);
    }

    if (total === 0) { doPrint(); return; }

    function onReady() {
      loaded++;
      if (loaded >= total) doPrint();
    }

    for (var i = 0; i < images.length; i++) {
      if (images[i].complete) onReady();
      else {
        images[i].addEventListener('load', onReady);
        images[i].addEventListener('error', onReady);
      }
    }

    setTimeout(function() { if (!printed) doPrint(); }, 3000);
  },

  // --- Helpers ---

  formatPrice: function(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
};

// Preload logo for canvas rendering
TicketService.preloadLogo();
