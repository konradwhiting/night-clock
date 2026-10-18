/* Night Clock: Sydney and Eastbourne time, plus a 24 hour forecast for both.
   Plain JavaScript, no build step. Written for Safari 17 (iPad 6th generation). */
(function () {
  'use strict';

  var CITIES = {
    syd: { name: 'Earlwood', tz: 'Australia/Sydney', lat: -33.92, lon: 151.13 },
    uk: { name: 'Eastbourne', tz: 'Europe/London', lat: 50.77, lon: 0.29 }
  };
  var KEYS = ['syd', 'uk'];
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
  els.syd.rainHead = $('syd-rain-head');
  els.syd.rainSub = $('syd-rain-sub');
  els.syd.ncWrap = $('syd-nc-wrap');
  els.syd.ncCap = $('syd-nc-cap');
  els.syd.nc = $('syd-nc');
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

    var gapMin = off.syd - off.uk;
    var gapH = Math.abs(gapMin) / 60;
    var gapText = (gapH % 1 ? gapH.toFixed(1) : gapH) + 'h ' + (gapMin >= 0 ? 'behind' : 'ahead');
    var dk = dayKey(z.uk) - dayKey(z.syd);
    var dayWord = dk < 0 ? ' · yesterday' : dk > 0 ? ' · tomorrow' : '';
    setText(els.uk.meta, 'ukmeta', zoneName('uk', off.uk) + ' · ' + gapText + dayWord);

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

  var weather = store.get('wx', null);
  var weatherTimer = null;

  function parseCity(o) {
    var h = o.hourly;
    return {
      t: h.time.map(function (s) { return Date.parse(s + ':00Z'); }),
      temp: h.temperature_2m,
      pop: h.precipitation_probability,
      code: h.weather_code,
      day: h.is_day,
      precip: h.precipitation,
      m15: o.minutely_15 ? { t: o.minutely_15.time.map(function (q) { return Date.parse(q + ':00Z'); }), mm: o.minutely_15.precipitation } : null
    };
  }

  function loadWeather() {
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + CITIES.syd.lat + ',' + CITIES.uk.lat
      + '&longitude=' + CITIES.syd.lon + ',' + CITIES.uk.lon
      + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,is_day'
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
        var next = { fetchedAt: Date.now(), syd: parseCity(arr[0]), uk: parseCity(arr[1]) };
        weather = next;
        store.set('wx', next);
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
  function rainSummary(win, nc, tz) {
    var n = 24, wet = [], total = 0, maxP = 0, pk = 0, i;
    for (i = 0; i < n; i++) {
      wet.push(win.pop[i] >= 50 || win.mm[i] >= 0.3);
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
    var parts = ['Now ' + Math.round(win.pop[0]) + '%'];
    if (maxP >= 10) parts.push('peak ' + Math.round(maxP) + '% at ' + hourLabel(win.t[pk], tz));
    if (total >= 0.1) parts.push('about ' + (total >= 10 ? Math.round(total) : total.toFixed(1)) + ' mm');
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
        e.temp.textContent = '--°';
        e.desc.textContent = weather ? 'Forecast out of date' : 'Loading forecast';
        e.range.textContent = '';
        e.chart.innerHTML = '';
        if (e.rainHead) { e.rainHead.textContent = ''; e.rainSub.textContent = ''; e.ncWrap.hidden = true; }
        return;
      }
      var hi = Math.max.apply(null, win.temp);
      var lo = Math.min.apply(null, win.temp);
      var maxPop = Math.max.apply(null, win.pop);
      e.temp.textContent = Math.round(win.temp[0]) + '°';
      e.desc.textContent = codeText(win.code[0]);
      var portrait = window.innerHeight > window.innerWidth;
      var cw = Math.round(e.chart.clientWidth) || 560;
      if (e.rainHead) {
        // Sydney: rain first, temperature kept small
        e.range.textContent = 'High ' + Math.round(hi) + '° · low ' + Math.round(lo) + '°';
        var rs = rainSummary(win, nowcastOf(weather[k]), CITIES[k].tz);
        e.rainHead.textContent = rs.head;
        e.rainSub.textContent = rs.sub;
        var nc = nowcastOf(weather[k]);
        e.ncWrap.hidden = !nc;
        if (nc) {
          e.ncCap.textContent = 'Next 2 hours · ' + nowcastText(nc);
          e.nc.innerHTML = nowcastSVG(nc, Math.round(e.nc.clientWidth) || 220, portrait ? 46 : 60);
        }
        e.chart.innerHTML = chartSVG(win, CITIES[k], cw, portrait ? 84 : 120, true);
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
  window.addEventListener('orientationchange', onResize);

  function renderFoot() {
    if (!weather) { foot.textContent = 'Forecast not loaded yet'; return; }
    var age = Date.now() - weather.fetchedAt;
    var z = zoned(new Date(weather.fetchedAt), CITIES.syd.tz);
    var t = clockText(z);
    var text = 'Forecast from Open-Meteo, updated ' + t.hm + t.ap + ' Earlwood time';
    if (age > STALE_MS) text += ' · may be out of date, retrying';
    foot.textContent = text;
  }

  /* ---------- regional headlines ---------- */

  // news.json is written by a scheduled GitHub Action (see .github/workflows/news.yml).
  var news = store.get('news', null);
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
      if (!n || !n.title) { box.hidden = true; return; }
      var age = n.published ? ' · ' + ago(Date.now() - Date.parse(n.published)) : '';
      $(k + '-news-src').textContent = n.source + age;
      $(k + '-news-title').textContent = n.title;
      box.hidden = false;
    });
  }

  function loadNews() {
    fetch('news.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { news = data; store.set('news', data); })
      .catch(function () { /* keep whatever we had */ })
      .then(function () {
        renderNews();
        setTimeout(loadNews, NEWS_REFRESH_MS);
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
    btnHours.textContent = 'Time: ' + (hour12 ? '12 hour' : '24 hour');
    btnDim.textContent = 'Brightness: ' + DIM_LABELS[dimMode];
  }

  function showControls() {
    controls.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { controls.hidden = true; }, 8000);
  }

  btnHours.addEventListener('click', function () {
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

  document.addEventListener('click', function (ev) {
    if (controls.contains(ev.target)) return;
    if (controls.hidden) { showControls(); keepAwake(); }
    else { controls.hidden = true; clearTimeout(hideTimer); }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      keepAwake();
      tick();
      if (!weather || Date.now() - weather.fetchedAt > REFRESH_OK_MS) loadWeather();
    }
  });

  /* ---------- start ---------- */

  renderControls();
  renderAwake();
  tick();
  renderWeather();
  renderNews();
  setInterval(tick, 1000);
  keepAwake();
  loadWeather();
  loadNews();
})();
