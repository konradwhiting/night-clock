/* Night Clock: Sydney and Eastbourne time, plus a 24 hour forecast for both.
   Plain JavaScript, no build step. Written for Safari 17 (iPad 6th generation). */
(function () {
  'use strict';

  // Change this whenever the page or its files change. Open clocks compare it with the
  // published app.js every half hour and reload themselves when it differs.
  var BUILD = '20261019-8';
  var SCRIPT_URL = document.currentScript && document.currentScript.src;

  var CITIES = {
    syd: { name: 'Earlwood', tz: 'Australia/Sydney', lat: -33.92, lon: 151.13 },
    uk: { name: 'Eastbourne', tz: 'Europe/London', lat: 50.77, lon: 0.29 }
  };
  // A page can narrow this down (see earlwood/index.html) by setting window.NIGHT_CLOCK first.
  var CFG = window.NIGHT_CLOCK || {};
  var KEYS = CFG.cities || ['syd', 'uk'];
  var BASE = CFG.base || '';       // where news.json lives, relative to the page
  var CACHE = CFG.cache || '';     // keeps each page's saved forecast and headlines apart
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
  var DIM_MODES = ['auto', 'bright', 'dim', 'dimmest'];
  var DIM_LABELS = { auto: 'Auto', bright: 'Bright', dim: 'Dim', dimmest: 'Dimmest' };
  var DIM_LEVEL = { bright: 0.95, dim: 0.6, dimmest: 0.32 };
  var AUTO_DAY = 0.9;
  var AUTO_NIGHT = 0.5;
  var REFRESH_OK_MS = 30 * 60 * 1000;
  var REFRESH_RETRY_MS = 5 * 60 * 1000;
  var STALE_MS = 3 * 60 * 60 * 1000;
  var PAGE_STARTED = Date.now();

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function put(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('nightclock.' + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('nightclock.' + k, JSON.stringify(v)); } catch (e) { /* storage may be blocked */ }
    }
  };

  var hour12 = store.get('hour12', false) === true;  // 24 hour unless the user switches
  var dimMode = store.get('dim', 'auto');
  if (DIM_MODES.indexOf(dimMode) < 0) dimMode = 'auto';

  /* ---------- time zones ---------- */

  var formatters = {};
  function zoned(date, tz) {
    var f = formatters[tz];
    if (!f) {
      f = formatters[tz] = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hourCycle: 'h23', weekday: 'long',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
    }
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return {
      y: +o.year, mo: +o.month, d: +o.day,
      h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: o.weekday
    };
  }

  function offsetMinutes(date, z) {
    var asUtc = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s);
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }

  function offsetText(m) {
    var sign = m < 0 ? '-' : '+';
    m = Math.abs(m);
    var h = Math.floor(m / 60), r = m % 60;
    return 'UTC' + sign + h + (r ? ':' + pad(r) : '');
  }

  function zoneName(key, off) {
    if (key === 'uk') return off === 0 ? 'GMT' : off === 60 ? 'BST' : offsetText(off);
    return off === 660 ? 'AEDT' : off === 600 ? 'AEST' : offsetText(off);
  }

  function dayKey(z) { return z.y * 10000 + z.mo * 100 + z.d; }

  function clockText(z) {
    if (hour12) {
      var h12 = (z.h % 12) || 12;
      return { hm: (h12 < 10 ? ' ' : '') + h12 + ':' + pad(z.mi), ap: z.h < 12 ? 'am' : 'pm' };
    }
    return { hm: pad(z.h) + ':' + pad(z.mi), ap: '' };
  }

  function hourLabel(ms, tz) {
    var z = zoned(new Date(ms), tz);
    return hour12 ? ((z.h % 12) || 12) + (z.h < 12 ? 'am' : 'pm') : pad(z.h) + ':00';
  }

  /* ---------- DOM handles ---------- */

  var app = $('app');
  var els = {};
  KEYS.forEach(function (k) {
    els[k] = {
      hm: $(k + '-hm'), ap: $(k + '-ap'), date: $(k + '-date'), meta: $(k + '-meta'),
      temp: $(k + '-temp'), desc: $(k + '-desc'), range: $(k + '-range'), chart: $(k + '-chart')
    };
  });
  els.syd.wear = $('syd-wear');
  els.syd.rainHead = $('syd-rain-head');
  els.syd.rainSub = $('syd-rain-sub');
  els.syd.ncWrap = $('syd-nc-wrap');
  els.syd.ncCap = $('syd-nc-cap');
  els.syd.nc = $('syd-nc');
  els.syd.grid = $('syd-grid');  // text-and-numbers forecast, used instead of the charts on the Earlwood page
  var foot = $('foot');
  var controls = $('controls');
  var btnHours = $('btn-hours');
  var btnDim = $('btn-dim');
  var awakeNote = $('awake');

  var last = {};
  function setText(el, key, value) {
    if (last[key] !== value) { last[key] = value; el.textContent = value; }
  }

  /* ---------- clock ---------- */

  var lastHourKey = null;
  var lastShift = null;
  var lastNewsMinute = null;
  var lastDim = null;

  function tick() {
    var now = new Date();
    var z = {}, off = {};
    KEYS.forEach(function (k) {
      z[k] = zoned(now, CITIES[k].tz);
      off[k] = offsetMinutes(now, z[k]);

      var t = clockText(z[k]);
      setText(els[k].hm, k + 'hm', t.hm);
      setText(els[k].ap, k + 'ap', t.ap);
      setText(els[k].date, k + 'date', z[k].wd + ' ' + z[k].d + ' ' + MONTHS[z[k].mo - 1]);
    });

    setText(els.syd.meta, 'sydmeta', zoneName('syd', off.syd));

    if (z.uk) {
      var gapMin = off.syd - off.uk;
      var gapH = Math.abs(gapMin) / 60;
      var gapText = (gapH % 1 ? gapH.toFixed(1) : gapH) + 'h ' + (gapMin >= 0 ? 'behind' : 'ahead');
      var dk = dayKey(z.uk) - dayKey(z.syd);
      var dayWord = dk < 0 ? ' · yesterday' : dk > 0 ? ' · tomorrow' : '';
      setText(els.uk.meta, 'ukmeta', zoneName('uk', off.uk) + ' · ' + gapText + dayWord);
    }

    // brightness
    var level = dimMode === 'auto'
      ? ((z.syd.h >= 21 || z.syd.h < 6) ? AUTO_NIGHT : AUTO_DAY)
      : DIM_LEVEL[dimMode];
    if (level !== lastDim) {
      lastDim = level;
      document.documentElement.style.setProperty('--dim', String(level));
      document.documentElement.style.setProperty('--ctl', String(Math.min(1, level + 0.3)));
    }

    // burn-in protection: nudge the whole display a few pixels each minute
    var minuteIndex = Math.floor(now.getTime() / 60000);
    if (minuteIndex !== lastShift) {
      lastShift = minuteIndex;
      var dx = ((minuteIndex * 7) % 25) - 12;
      var dy = ((minuteIndex * 11) % 17) - 8;
      app.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    if (minuteIndex !== lastNewsMinute) { lastNewsMinute = minuteIndex; if (typeof renderNews === 'function') renderNews(); }

    // the forecast window moves on every hour, the two hour rain strip every quarter hour
    var hourKey = Math.floor(now.getTime() / 900000);
    if (hourKey !== lastHourKey) {
      lastHourKey = hourKey;
      renderWeather();
    }

    // pick up new versions of the page: reload once a day at 3am Sydney time
    if (now.getTime() - PAGE_STARTED > 20 * 3600 * 1000 && z.syd.h === 3 && z.syd.mi < 5) {
      location.reload();
    }
  }

  /* ---------- weather ---------- */

  var weather = store.get(CACHE + 'wx', null);
  var weatherTimer = null;

  // Six independent forecast models. Temperature is their average. "Rain chance" is the share of models that
  // expect measurable rain in that hour, so one model on its own can no longer send you out with an umbrella.
  var MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless', 'ukmo_seamless', 'meteofrance_seamless'];
  var NMODELS = MODELS.length;

  function parseCity(o) {
    var h = o.hourly;
    function each(base) {
      return MODELS.map(function (m) { return h[base + '_' + m]; }).filter(Boolean);
    }
    function col(lists, i) {
      return lists.map(function (a) { return a[i]; }).filter(function (v) { return v != null; });
    }
    var temps = each('temperature_2m'), precs = each('precipitation');
    var temp = [], pop = [], precip = [];
    h.time.forEach(function (_, i) {
      var t = col(temps, i), p = col(precs, i);
      temp.push(t.length ? t.reduce(function (a, b) { return a + b; }, 0) / t.length : h.temperature_2m_best_match[i]);
      precip.push(p.length ? p.reduce(function (a, b) { return a + b; }, 0) / p.length : 0);
      pop.push(p.length ? p.filter(function (v) { return v >= 0.1; }).length / p.length * 100 : 0);
    });
    return {
      t: h.time.map(function (s) { return Date.parse(s + ':00Z'); }),
      temp: temp,
      pop: pop,
      code: h.weather_code_best_match,  // only used for the sky description
      day: h.is_day_best_match,
      precip: precip,
      m15: o.minutely_15 ? { t: o.minutely_15.time.map(function (q) { return Date.parse(q + ':00Z'); }), mm: o.minutely_15.precipitation_best_match } : null
    };
  }

  function loadWeather() {
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + KEYS.map(function (k) { return CITIES[k].lat; }).join(',')
      + '&longitude=' + KEYS.map(function (k) { return CITIES[k].lon; }).join(',')
      + '&hourly=temperature_2m,precipitation,weather_code,is_day'
      + '&models=' + MODELS.join(',') + ',best_match'
      + '&minutely_15=precipitation'
      + '&timezone=GMT&forecast_days=3';
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);

    return fetch(url, ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var arr = Array.isArray(data) ? data : [data];
        var next = { fetchedAt: Date.now() };
        KEYS.forEach(function (k, i) { next[k] = parseCity(arr[i]); });
        weather = next;
        store.set(CACHE + 'wx', next);
        renderWeather();
        scheduleWeather(REFRESH_OK_MS);
      })
      .catch(function () {
        renderWeather();
        scheduleWeather(REFRESH_RETRY_MS);
      })
      .then(function () { clearTimeout(timer); });
  }

  function scheduleWeather(ms) {
    clearTimeout(weatherTimer);
    weatherTimer = setTimeout(loadWeather, ms);
  }

  function windowOf(w) {
    if (!w || !w.t) return null;
    var h0 = Math.floor(Date.now() / 3600000) * 3600000;
    var i = -1;
    for (var j = 0; j < w.t.length; j++) { if (w.t[j] >= h0) { i = j; break; } }
    if (i < 0 || i + 24 >= w.t.length) return null;
    function cut(a) { return a.slice(i, i + 25); }
    return {
      t: cut(w.t),
      temp: cut(w.temp).map(function (v) { return v == null ? 0 : v; }),
      pop: cut(w.pop).map(function (v) { return v == null ? 0 : v; }),
      code: cut(w.code),
      day: cut(w.day),
      mm: cut(w.precip || w.t.map(function () { return 0; })).map(function (v) { return v == null ? 0 : v; })
    };
  }

  // Next two hours in 15 minute steps (8 values, mm). Null if the data is missing or stale.
  function nowcastOf(w) {
    if (!w || !w.m15) return null;
    var q0 = Math.floor(Date.now() / 900000) * 900000, i = -1;
    for (var j = 0; j < w.m15.t.length; j++) { if (w.m15.t[j] >= q0) { i = j; break; } }
    if (i < 0 || i + 8 > w.m15.t.length) return null;
    return w.m15.mm.slice(i, i + 8).map(function (v) { return v == null ? 0 : v; });
  }

  // Plain-words rain outlook for the next 24 hours.
  // Rain total in words a child can picture instead of millimetres
  function wetWords(mm) {
    if (mm < 1) return 'just a sprinkle';
    if (mm < 5) return 'light drizzle';
    if (mm < 15) return 'proper rain, puddles to jump in';
    if (mm < 30) return 'heavy rain, big puddles';
    return 'a downpour, stay inside';
  }

  // Temperature in words a child can picture (the number is always shown beside it)
  function tempWords(t) {
    if (t < 8) return 'freezing, big coat and beanie';
    if (t < 13) return 'cold, coat on';
    if (t < 18) return 'chilly, jumper weather';
    if (t < 23) return 'mild, nice to be outside';
    if (t < 28) return 'warm, t-shirt weather';
    if (t < 33) return 'hot, hat and sunscreen';
    return 'very hot, stay cool and drink water';
  }

  // What to wear for the day's high: a short word, a reason, and which picture to show
  function svg(body) { return '<svg viewBox="0 0 64 64">' + body + '</svg>'; }
  var JUMPER = 'M22 8L6 20l2 30h8l2-20v26h28V30l2 20h8l2-30L42 8c-2 4-6 6-10 6s-8-2-10-6z';
  var ICONS = {
    tshirt: svg('<path d="M22 8L8 16l6 12 6-3v31h24V25l6 3 6-12-14-8c-2 4-6 6-10 6s-8-2-10-6z"/>'),
    jumper: svg('<path d="' + JUMPER + '"/>'),
    coat: svg('<path d="' + JUMPER + '"/><path d="M32 14v42"/>'),
    sun: svg('<circle cx="32" cy="32" r="10" style="fill:none"/><path d="M32 6v8M32 50v8M6 32h8M50 32h8M14 14l6 6M44 44l6 6M14 50l6-6M44 20l6-6"/>'),
    hat: svg('<path d="M16 36c0-12 6-20 16-20s16 8 16 20M6 40c0-3 12-6 26-6s26 3 26 6-12 6-26 6S6 43 6 40zM17 31c10 3 20 3 30 0"/>'),
    umbrella: svg('<path d="M32 6V3M5 34C5 18 18 8 32 8s27 10 27 26c-4-5-8-5-13.5 0C41 29 37 29 32 34c-5-5-9-5-13.5 0C13 29 9 29 5 34z"/><path d="M32 34v16a6 6 0 0 1-12 0"/>'),
    boots: svg('<path d="M8 8h15v30l13 6v10H8zM40 14h14v24l6 3v13H40z"/>'),
    raincoat: svg('<path d="' + JUMPER + '"/><path d="M22 8c0-10 20-10 20 0M32 14v42"/>'),
    tram: svg('<path d="M32 8V2M20 2h24"/><rect x="14" y="8" width="36" height="38" rx="6"/><rect x="20" y="14" width="24" height="14" rx="2"/><circle cx="22" cy="38" r="2.5"/><circle cx="42" cy="38" r="2.5"/><path d="M22 46l-6 12M42 46l6 12"/>'),
    tramx: svg('<path d="M32 8V2M20 2h24"/><rect x="14" y="8" width="36" height="38" rx="6"/><rect x="20" y="14" width="24" height="14" rx="2"/><circle cx="22" cy="38" r="2.5"/><circle cx="42" cy="38" r="2.5"/><path d="M22 46l-6 12M42 46l6 12"/><path d="M6 6L58 58" style="stroke-width:5"/>')
  };
  function setIcons(id, list) {
    var el = $(id);
    if (!el) return;
    el.className = list.length > 2 ? 'ico ico-3' : list.length > 1 ? 'ico ico-2' : 'ico';
    el.innerHTML = list.map(function (n) { return ICONS[n]; }).join('');
  }

  // Which band of weather a temperature falls in: a short word for the row, a feel word, and the pictures
  function wearWords(t) {
    if (t < 8) return { word: 'Big coat', feel: 'Freezing', icons: ['coat'] };
    if (t < 13) return { word: 'Coat', feel: 'Cold', icons: ['coat'] };
    if (t < 18) return { word: 'Warm jumper', feel: 'Chilly', icons: ['jumper'] };
    if (t < 23) return { word: 'Jumper', feel: 'Mild', icons: ['jumper'] };
    if (t < 28) return { word: 'T-shirt', feel: 'Warm', icons: ['tshirt'] };
    if (t < 33) return { word: 'T-shirt and hat', feel: 'Hot', icons: ['sun', 'hat'] };
    return { word: 'Keep cool', feel: 'Very hot', icons: ['sun', 'hat'] };
  }

  // What to wear when you leave, and what you will want later. startLabel is 'Now' or 'At 7am'.
  function wearAdvice(start, hi, startLabel) {
    var a = wearWords(start), b = wearWords(hi);
    var s0 = Math.round(start), h0 = Math.round(hi);
    if (a.word !== b.word && hi - start >= 4) {
      var pics = a.icons.concat(b.icons.filter(function (n) { return a.icons.indexOf(n) < 0; })).slice(0, 2);
      return { word: a.word, sub: startLabel + ' ' + s0 + '° · warming to ' + h0 + '° (' + b.word.toLowerCase() + ' later)', icons: pics };
    }
    return { word: b.word, sub: b.feel + ' · ' + startLabel.toLowerCase() + ' ' + s0 + '°, high ' + h0 + '°', icons: b.icons };
  }

  // The part of the day the page is about. Until 5pm: the rest of today (to 10pm). After 5pm: tomorrow, 6am to 6pm.
  // Returns indexes into the forecast arrays plus the matching day's high.
  function dayPlan(w, tz, nowTemp) {
    var now = Date.now(), z = zoned(new Date(now), tz);
    var tomorrow = z.h >= 17;
    var hourStart = Math.floor(now / 3600000) * 3600000;
    var from, to, key;
    if (!tomorrow) {
      from = hourStart; to = hourStart + (22 - z.h) * 3600000;
      key = dayKey(z);
    } else {
      from = hourStart + (24 - z.h + 6) * 3600000; to = from + 12 * 3600000;
      key = dayKey(zoned(new Date(now + 86400000), tz));
    }
    var idx = [], hi = -Infinity, startTemp = nowTemp, i;
    for (i = 0; i < w.t.length; i++) {
      if (w.t[i] >= from && w.t[i] < to) idx.push(i);
      if (w.temp[i] != null && dayKey(zoned(new Date(w.t[i]), tz)) === key && w.temp[i] > hi) hi = w.temp[i];
      if (tomorrow && w.t[i] === from + 3600000) startTemp = w.temp[i];
    }
    if (!idx.length || hi === -Infinity) return null;
    return { tomorrow: tomorrow, idx: idx, hi: hi, startTemp: startTemp };
  }

  // Umbrella verdict and a plain-words story for the window, from the blended forecasts
  function rainOutlook(w, plan, tz) {
    var idx = plan.idx, n = idx.length, maxP = 0, pk = 0, total = 0, first = -1, last = -1, k;
    for (k = 0; k < n; k++) {
      var p = w.pop[idx[k]], mm = w.precip[idx[k]] || 0;
      total += mm;
      if (p > maxP) { maxP = p; pk = k; }
      if (p >= 50 || mm >= 0.5) { if (first < 0) first = k; last = k; }
    }
    var level = maxP >= 50 || total >= 1 ? 'yes' : maxP >= 30 || total >= 0.3 ? 'maybe' : 'no';  // half the models agree, or a third
    var head = level === 'no' ? 'No umbrella' : level === 'maybe' ? 'Maybe an umbrella'
      : total >= 15 ? 'Umbrella and raincoat' : total >= 5 ? 'Umbrella and gumboots' : 'Take an umbrella';
    function hr(k2) { return hourLabel(w.t[idx[k2]], tz); }
    var story;
    if (first < 0) {
      story = maxP >= 30 ? 'Some forecasts show showers around ' + hr(pk) : plan.tomorrow ? 'Dry all day tomorrow' : 'Dry for the rest of today';
    } else if (first === 0) {
      var ends = last < n - 1 ? 'easing by ' + hr(last + 1) : 'rain all day';
      story = plan.tomorrow ? 'Rain early, ' + ends : 'Raining now, ' + ends;
    } else {
      story = 'Rain from ' + hr(first) + (last < n - 1 ? ' to ' + hr(last + 1) : ' on');
    }
    var kPk = Math.round(maxP / 100 * NMODELS);
    var note = kPk > 0 ? kPk + ' of ' + NMODELS + ' forecasts show rain at ' + hr(pk) : 'No forecast shows rain';
    if (level !== 'no' && total >= 0.1) note += ' · ' + wetWords(total);
    var icons = ['umbrella'];
    if (level === 'yes' && total >= 15) icons = ['umbrella', 'raincoat', 'boots'];
    else if (level === 'yes' && total >= 5) icons = ['umbrella', 'boots'];
    return { head: head, story: story, note: note, level: level, icons: icons };
  }

  function rainSummary(win, nc, tz) {
    var n = 24, wet = [], total = 0, maxP = 0, pk = 0, i;
    for (i = 0; i < n; i++) {
      wet.push(win.pop[i] >= 50 || win.mm[i] >= 0.5);
      total += win.mm[i];
      if (win.pop[i] > maxP) { maxP = win.pop[i]; pk = i; }
    }
    var nowWet = nc ? (nc[0] >= 0.1 || nc[1] >= 0.1) : wet[0];
    var head, end;
    if (nowWet) {
      end = -1;
      for (i = 1; i < n; i++) { if (!wet[i]) { end = i; break; } }
      head = end < 0 ? 'Rain all day' : 'Rain easing by ' + hourLabel(win.t[end], tz);
    } else {
      var start = -1;
      for (i = 0; i < n; i++) { if (wet[i]) { start = i; break; } }
      if (start === 0) {
        head = 'Rain likely soon';
      } else if (start > 0) {
        end = start + 1;
        while (end < n && wet[end]) end++;
        head = end < n
          ? 'Rain ' + hourLabel(win.t[start], tz) + ' to ' + hourLabel(win.t[end], tz)
          : 'Rain from ' + hourLabel(win.t[start], tz);
      } else if (maxP >= 20) {
        head = 'Dry, slim chance of showers';
      } else {
        head = 'Dry for the next 24 hours';
      }
    }
    var parts = [];
    var kPk = Math.round(maxP / 100 * NMODELS);
    parts.push(kPk > 0 ? kPk + ' of ' + NMODELS + ' forecasts show rain' + (maxP >= 10 ? ' at ' + hourLabel(win.t[pk], tz) : '') : 'No forecast shows rain');
    if (total >= 0.1) parts.push(wetWords(total));
    return { head: head, sub: parts.join(' · ') };
  }

  function nowcastText(nc) {
    var peak = Math.max.apply(null, nc);
    if (peak < 0.1) return 'Dry';
    if (peak < 0.5) return 'Light rain';
    if (peak < 1.5) return 'Moderate rain';
    return 'Heavy rain';
  }

  function nowcastSVG(nc, W, H) {
    var AX = H - 16, peak = Math.max(1, Math.max.apply(null, nc)), bw = (W - 2) / nc.length;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rain in the next two hours">';
    nc.forEach(function (v, i) {
      if (v < 0.05) return;
      var bh = Math.max(3, v / peak * (AX - 4));
      s += '<rect class="bar bar-nc" x="' + (1 + i * bw + 2).toFixed(1) + '" y="' + (AX - bh).toFixed(1)
        + '" width="' + (bw - 4).toFixed(1) + '" height="' + bh.toFixed(1) + '"/>';
    });
    s += '<line class="axis" x1="0" y1="' + AX + '" x2="' + W + '" y2="' + AX + '"/>';
    [['Now', 0, 'start'], ['+1h', W / 2, 'middle'], ['+2h', W, 'end']].forEach(function (m) {
      s += '<text class="lbl lbl-sm" x="' + m[1] + '" y="' + (H - 2) + '" text-anchor="' + m[2] + '">' + m[0] + '</text>';
    });
    return s + '</svg>';
  }

  function codeText(c) {
    if (c === 0) return 'Clear';
    if (c === 1) return 'Mostly clear';
    if (c === 2) return 'Partly cloudy';
    if (c === 3) return 'Overcast';
    if (c === 45 || c === 48) return 'Fog';
    if (c >= 51 && c <= 55) return 'Drizzle';
    if (c === 56 || c === 57) return 'Freezing drizzle';
    if (c === 61) return 'Light rain';
    if (c === 63) return 'Rain';
    if (c === 65) return 'Heavy rain';
    if (c === 66 || c === 67) return 'Freezing rain';
    if (c >= 71 && c <= 75) return 'Snow';
    if (c === 77) return 'Snow grains';
    if (c >= 80 && c <= 82) return 'Showers';
    if (c === 85 || c === 86) return 'Snow showers';
    if (c === 95) return 'Thunderstorm';
    if (c === 96 || c === 99) return 'Thunderstorm with hail';
    return '';
  }

  // W and H are the chart's real pixel size, so labels stay a readable size in narrow columns.
  function chartSVG(win, city, W, H, rainLed) {
    var L = 8, R = 8;
    var NT = Math.round(H * 0.06), TOP = Math.max(34, Math.round(H * 0.22)), LB = Math.round(H * 0.5);
    var AX = Math.round(H * 0.8), BAR = Math.round(H * 0.22), LBL = Math.round(H * 0.97);
    if (rainLed) { NT = 4; TOP = NT + 12; AX = H - 24; LB = AX - 12; BAR = AX - NT; LBL = H - 4; }
    var n = win.temp.length;
    var step = (W - L - R) / (n - 1);
    function x(i) { return L + step * i; }

    var hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    win.temp.forEach(function (v, i) {
      if (v > hi) { hi = v; hiI = i; }
      if (v < lo) { lo = v; loI = i; }
    });
    var span = Math.max(hi - lo, 4);
    var mid = (hi + lo) / 2;
    function y(v) { return (TOP + LB) / 2 - (v - mid) / span * (LB - TOP); }

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="'
      + city.name + ' temperature and rain chance for the next 24 hours">';

    // night hours shaded
    var i = 0;
    while (i < n - 1) {
      if (!win.day[i]) {
        var j = i;
        while (j < n - 1 && !win.day[j]) j++;
        s += '<rect class="night" x="' + x(i).toFixed(1) + '" y="' + NT + '" width="'
          + ((j - i) * step).toFixed(1) + '" height="' + (AX - NT) + '"/>';
        i = j;
      } else {
        i++;
      }
    }

    // rain chance bars
    for (i = 0; i < n - 1; i++) {
      var p = win.pop[i];
      if (p >= 5) {
        var bh = Math.max(2, p / 100 * BAR);
        s += '<rect class="bar' + (rainLed ? ' bar-led' : '') + '" x="' + (x(i) + 1.5).toFixed(1) + '" y="' + (AX - bh).toFixed(1)
          + '" width="' + Math.max(2, step - 3).toFixed(1) + '" height="' + bh.toFixed(1) + '"/>';
      }
    }

    s += '<line class="axis" x1="' + L + '" y1="' + AX + '" x2="' + (W - R) + '" y2="' + AX + '"/>';

    if (rainLed) {
      // rain chance is the main story: a 50% guide line, the peak labelled, temperature kept as a thin line
      var gy = AX - 0.5 * BAR;
      s += '<line class="grid" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '"/>';
      s += '<text class="lbl lbl-sm lbl-halo" x="' + (W - R) + '" y="' + (gy - 4).toFixed(1) + '" text-anchor="end">50% chance</text>';
      var pk = 0;
      for (i = 0; i < n - 1; i++) { if (win.pop[i] > win.pop[pk]) pk = i; }
      if (win.pop[pk] >= 10) {
        var py = Math.max(16, AX - win.pop[pk] / 100 * BAR - 6);
        var px = Math.min(W - 24, Math.max(24, x(pk) + step / 2));
        s += '<text class="val" x="' + px.toFixed(1) + '" y="' + py.toFixed(1) + '" text-anchor="middle">'
          + Math.round(win.pop[pk]) + '%</text>';
      }
    }

    // temperature
    var pts = win.temp.map(function (v, k) { return x(k).toFixed(1) + ',' + y(v).toFixed(1); });
    if (!rainLed) s += '<polygon class="area" points="' + pts.join(' ') + ' ' + x(n - 1).toFixed(1) + ',' + (LB + 10)
      + ' ' + x(0).toFixed(1) + ',' + (LB + 10) + '"/>';
    s += '<polyline class="tline' + (rainLed ? ' tline-thin' : '') + '" points="' + pts.join(' ') + '"/>';
    if (!rainLed) s += '<circle class="dot" cx="' + x(0).toFixed(1) + '" cy="' + y(win.temp[0]).toFixed(1) + '" r="6"/>';

    function valueLabel(idx, v, dy) {
      var xx = Math.min(W - 20, Math.max(20, x(idx)));
      return '<text class="val" x="' + xx.toFixed(1) + '" y="' + (y(v) + dy).toFixed(1)
        + '" text-anchor="middle">' + Math.round(v) + '°</text>';
    }
    if (!rainLed) {
      s += valueLabel(hiI, hi, -10);
      if (loI !== hiI && hi - lo >= 1) s += valueLabel(loI, lo, 30);
    }

    // hour labels
    var marks = W < 360 ? [0, 8, 16, 24] : [0, 6, 12, 18, 24];  // fewer labels in a narrow column
    marks.forEach(function (k) {
      var anchor = k === 0 ? 'start' : k === 24 ? 'end' : 'middle';
      var text = k === 0 ? 'Now' : hourLabel(win.t[k], city.tz);
      s += '<line class="tick" x1="' + x(k).toFixed(1) + '" y1="' + AX + '" x2="' + x(k).toFixed(1)
        + '" y2="' + (AX + 7) + '"/>';
      s += '<text class="lbl" x="' + x(k).toFixed(1) + '" y="' + LBL + '" text-anchor="' + anchor + '">'
        + text + '</text>';
    });

    return s + '</svg>';
  }

  function renderWeather() {
    KEYS.forEach(function (k) {
      var e = els[k];
      var win = weather ? windowOf(weather[k]) : null;
      if (!win) {
        if (e.temp) e.temp.textContent = '--°';
        if (e.desc) e.desc.textContent = weather ? 'Forecast out of date' : 'Loading forecast';
        e.range.textContent = e.wear ? '--°' : '';
        if (e.wear) e.wear.textContent = weather ? 'Out of date' : 'Loading';
        if (e.chart) e.chart.innerHTML = '';
        if (e.rainHead) { e.rainHead.textContent = ''; e.rainSub.textContent = ''; if (e.ncWrap) e.ncWrap.hidden = true; if (e.grid) e.grid.innerHTML = ''; }
        return;
      }
      var hi = Math.max.apply(null, win.temp);
      var lo = Math.min.apply(null, win.temp);
      var maxPop = Math.max.apply(null, win.pop);
      if (e.temp) e.temp.textContent = Math.round(win.temp[0]) + '°';
      if (e.desc) e.desc.textContent = codeText(win.code[0]);
      var portrait = window.innerHeight > window.innerWidth;
      var cw = e.chart ? Math.round(e.chart.clientWidth) || 560 : 0;
      if (e.rainHead) {
        // Sydney: rain first, temperature kept small
        e.range.textContent = 'High ' + Math.round(hi) + '° · low ' + Math.round(lo) + '°';
        var rs = rainSummary(win, nowcastOf(weather[k]), CITIES[k].tz);
        e.rainHead.textContent = rs.head;
        e.rainSub.textContent = rs.sub;
        var nc = nowcastOf(weather[k]);
        if (e.ncWrap) e.ncWrap.hidden = !nc;
        if (!e.chart) {
          // text only (Earlwood page): what to wear, and whether to take an umbrella, for today or tomorrow
          var plan = dayPlan(weather[k], CITIES[k].tz, win.temp[0]);
          if (!plan) { e.wear.textContent = 'Out of date'; return; }
          var w = wearAdvice(plan.startTemp, plan.hi, plan.tomorrow ? 'At 7am' : 'Now');
          e.range.textContent = Math.round(plan.hi) + '°';
          e.wear.textContent = w.word;
          put('syd-wear-sub', w.sub);
          put('wear-cap', plan.tomorrow ? 'Tomorrow, what to wear' : 'What to wear');
          put('wear-num-cap', plan.tomorrow ? "tomorrow's high" : "today's high");
          setIcons('wear-ico', w.icons);
          var u = rainOutlook(weather[k], plan, CITIES[k].tz);
          put('rain-cap', plan.tomorrow ? 'Rain tomorrow?' : 'Rain today?');
          e.rainHead.textContent = u.head;
          e.rainSub.textContent = u.story;
          put('syd-rain-note', u.note);
          setIcons('rain-ico', u.icons);
          var tr = $('tile-rain'); if (tr) tr.className = 'row ' + (u.level === 'yes' ? 'on' : u.level === 'maybe' ? 'maybe' : 'quiet');
          return;
        }
        if (nc) {
          e.ncCap.textContent = 'Next 2 hours · ' + nowcastText(nc);
          e.nc.innerHTML = nowcastSVG(nc, Math.round(e.nc.clientWidth) || 220, portrait ? 46 : (window.innerHeight <= 640 ? 40 : 60));
        }
        var roomy = !$(k + '-news');  // without a headline there is more height for the chart
        e.chart.innerHTML = chartSVG(win, CITIES[k], cw, roomy ? Math.max(70, Math.round(e.chart.clientHeight) || 150) : (portrait ? 84 : 120), true);
      } else {
        e.range.textContent = 'Next 24h: high ' + Math.round(hi) + '°, low ' + Math.round(lo) + '° · '
          + (maxPop < 10 ? 'no rain expected' : 'rain chance up to ' + Math.round(maxPop) + '%');
        e.chart.innerHTML = chartSVG(win, CITIES[k], cw, portrait ? 150 : 190);
      }
    });
    renderFoot();
  }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderWeather, 250);
  }
  window.addEventListener('resize', onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderWeather);
  window.addEventListener('orientationchange', onResize);

  function renderFoot() {
    if (!weather) { foot.textContent = 'Forecast not loaded yet'; return; }
    var age = Date.now() - weather.fetchedAt;
    var z = zoned(new Date(weather.fetchedAt), CITIES.syd.tz);
    var t = clockText(z);
    var text = 'Average of ' + NMODELS + ' forecasts via Open-Meteo, updated ' + t.hm + t.ap + ' Earlwood time';
    if (age > STALE_MS) text += ' · may be out of date, retrying';
    foot.textContent = text;
  }

  /* ---------- regional headlines ---------- */

  // news.json is written by a scheduled GitHub Action (see .github/workflows/news.yml).
  var news = store.get(CACHE + 'news', null);
  var NEWS_REFRESH_MS = 30 * 60 * 1000;

  function ago(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function renderNews() {
    KEYS.forEach(function (k) {
      var n = news && news[k];
      var box = $(k + '-news');
      if (!box) return;  // this page has no headline area
      if (!n || !n.title) { box.hidden = true; return; }
      var age = n.published ? ' · ' + ago(Date.now() - Date.parse(n.published)) : '';
      $(k + '-news-src').textContent = (n.area ? n.area + ' · ' : '') + n.source + age;
      $(k + '-news-title').textContent = n.title;
      box.hidden = false;
    });
  }

  function loadNews() {
    if (!$('syd-news')) return;  // no headline area on this page, nothing to fetch
    fetch(BASE + 'news.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { news = data; store.set(CACHE + 'news', data); })
      .catch(function () { /* keep whatever we had */ })
      .then(function () {
        renderNews();
        setTimeout(loadNews, NEWS_REFRESH_MS);
      });
  }

  /* ---------- light rail status ---------- */

  // lightrail.json is written by a scheduled GitHub Action (see .github/workflows/lightrail.yml).
  var rail = store.get(CACHE + 'rail', null);
  var RAIL_REFRESH_MS = 5 * 60 * 1000;
  var RAIL_STALE_MS = 90 * 60 * 1000;  // the job rewrites an unchanged status at least hourly

  function renderRail() {
    var box = $('rail');
    if (!box) return;  // this page has no light rail area
    var head, sub, quiet = true;
    var age = rail && rail.updated ? Date.now() - Date.parse(rail.updated) : Infinity;
    if (!rail || rail.state === 'setup') {
      head = 'Not connected yet';
      sub = 'Waiting for the Transport for NSW key';
    } else if (rail.state === 'error') {
      head = rail.text;
      sub = rail.detail;
    } else if (age > RAIL_STALE_MS) {
      var z = zoned(new Date(Date.parse(rail.updated)), CITIES.syd.tz);
      var t = clockText(z);
      head = 'Status out of date';
      sub = 'Last checked ' + t.hm + t.ap;
    } else {
      head = rail.text;
      sub = rail.detail;
      quiet = rail.state === 'ontime' || rail.state === 'quiet';
    }
    var label = 'Light rail L1 Dulwich Hill';
    if (rail && rail.updated && rail.state !== 'setup') {
      var ct = clockText(zoned(new Date(Date.parse(rail.updated)), CITIES.syd.tz));
      label += ' · checked ' + ct.hm + ct.ap;
      if (age > 20 * 60000) label += ' (' + (age > 90 * 60000 ? Math.round(age / 3600000) + ' h' : Math.round(age / 60000) + ' min') + ' ago)';
    }
    put('rail-label', label);
    var ri = $('rail-ico');
    if (ri) ri.innerHTML = ICONS[rail && rail.cancelled > 0 && rail.state !== 'setup' ? 'tramx' : 'tram'];
    put('rail-head', head);
    put('rail-sub', sub || '');
    box.className = quiet ? 'row quiet' : 'row on';
  }

  function loadRail() {
    if (!$('rail')) return;  // no light rail area on this page, nothing to fetch
    fetch(BASE + 'lightrail.json?t=' + Math.floor(Date.now() / 120000), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { rail = data; store.set(CACHE + 'rail', data); })
      .catch(function () { /* keep whatever we had */ })
      .then(function () {
        renderRail();
        setTimeout(loadRail, RAIL_REFRESH_MS);
      });
  }

  /* ---------- screen wake lock ---------- */

  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) {
      renderAwake();
      return;
    }
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; renderAwake(); });
      renderAwake();
    }).catch(function () { renderAwake(); });
  }

  function renderAwake() {
    awakeNote.textContent = wakeLock
      ? 'Screen is being kept awake.'
      : 'To keep the screen on, set Auto-Lock to Never in Settings.';
  }

  /* ---------- controls ---------- */

  var hideTimer = null;
  function renderControls() {
    if (btnHours) btnHours.textContent = 'Time: ' + (hour12 ? '12 hour' : '24 hour');
    btnDim.textContent = 'Brightness: ' + DIM_LABELS[dimMode];
  }

  function showControls() {
    controls.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { controls.hidden = true; }, 8000);
  }

  if (btnHours) btnHours.addEventListener('click', function () {
    hour12 = !hour12;
    store.set('hour12', hour12);
    last = {};
    renderControls();
    tick();
    renderWeather();
    showControls();
  });

  btnDim.addEventListener('click', function () {
    dimMode = DIM_MODES[(DIM_MODES.indexOf(dimMode) + 1) % DIM_MODES.length];
    store.set('dim', dimMode);
    lastDim = null;
    renderControls();
    tick();
    showControls();
  });

  // Full screen: for browsers that allow it (Chrome on Android does, Safari on iPad does not).
  var btnFull = $('btn-full');
  var fsRoot = document.documentElement;
  var fsRequest = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
  var fsExit = document.exitFullscreen || document.webkitExitFullscreen;
  function inFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function renderFull() { btnFull.textContent = inFullscreen() ? 'Exit full screen' : 'Full screen'; }
  var standalone = navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (btnFull && fsRequest && fsExit && !standalone) {  // already full screen when run from the Home Screen
    btnFull.hidden = false;
    renderFull();
    btnFull.addEventListener('click', function () {
      try {
        var p = inFullscreen() ? fsExit.call(document) : fsRequest.call(fsRoot);
        if (p && p.catch) p.catch(function () { /* the browser said no */ });
      } catch (e) { /* ignore */ }
      showControls();
    });
    document.addEventListener('fullscreenchange', renderFull);
    document.addEventListener('webkitfullscreenchange', renderFull);
  }

  document.addEventListener('click', function (ev) {
    if (controls.contains(ev.target)) return;
    if (controls.hidden) { showControls(); keepAwake(); }
    else { controls.hidden = true; clearTimeout(hideTimer); }
  });

  // The copy fetched at start is what the browser already holds; 'reload' fetches the published one
  // and refreshes the browser's cache, so location.reload() then loads the new files.
  var baseline = {};
  function fetchText(url, mode) {
    return fetch(url, { cache: mode }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; });
  }
  function watched() { return [SCRIPT_URL && SCRIPT_URL.split('?')[0], location.href.split('#')[0].split('?')[0]].filter(Boolean); }
  function rememberBaseline() {
    watched().forEach(function (u) { fetchText(u, 'default').then(function (t) { if (t) baseline[u] = t.length + ':' + t.slice(-200); }); });
  }
  function checkForUpdate() {
    watched().forEach(function (u) {
      fetchText(u, 'reload').then(function (t) {
        var sig = t ? t.length + ':' + t.slice(-200) : '';
        var m = t.match(/var BUILD = '([^']+)'/);
        if (sig && ((baseline[u] && baseline[u] !== sig) || (m && m[1] !== BUILD))) location.reload();
      });
    });
  }
  rememberBaseline();
  setTimeout(checkForUpdate, 2 * 60 * 1000);  // soon after start, in case the page came from a stale cache
  setInterval(checkForUpdate, 30 * 60 * 1000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      keepAwake();
      tick();
      if (!weather || Date.now() - weather.fetchedAt > REFRESH_OK_MS) loadWeather();
      renderRail();
    }
  });

  /* ---------- start ---------- */

  renderControls();
  renderAwake();
  tick();
  renderWeather();
  renderNews();
  renderRail();
  setInterval(tick, 1000);
  keepAwake();
  loadWeather();
  loadNews();
  loadRail();
})();
