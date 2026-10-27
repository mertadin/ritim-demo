// Fake native bridge for the Ritim web demo: window.Capacitor.Plugins.Ritim on fictional data.
(function () {
  "use strict";
  var KEY = "ritim-demo-v1";
  var VERSION = "1.7.1 · demo";
  var SETTINGS_NOTE = "Demoda telefon ayarları yok; örnek veri gösteriliyor.";
  var MAX_RC = 4999;
  var BLOOD = ["", "0 Rh+", "0 Rh-", "A Rh+", "A Rh-", "B Rh+", "B Rh-", "AB Rh+", "AB Rh-"];
  var PHONE_RE = /^[0-9+()\-\s]*$/;
  var listeners = {};
  var mem = null; // in-memory fallback when localStorage is unavailable
  var S = null;
  var counter = 0;

  // ---- storage ----
  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = mem; }
    if (raw) { try { var o = JSON.parse(raw); if (isObj(o)) return fill(o); } catch (e) { /* reseed */ } }
    return fill(window.DEMO_DATA.seed());
  }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function docsOk(v) {
    return Array.isArray(v) && v.every(function (d) { return isObj(d) && typeof d.id === "string" && typeof d.url === "string"; });
  }
  function fill(o) {
    var d = window.DEMO_DATA.seed();
    if (typeof o.createdAt !== "number" || !o.createdAt) o.createdAt = Date.now();
    if (typeof o.onboarded !== "boolean") o.onboarded = true; // no native permission flow in the demo
    if (typeof o.walkCheck !== "boolean") o.walkCheck = true;
    ["meds", "doctors", "appointments", "bpTimes"].forEach(function (k) { if (!Array.isArray(o[k])) o[k] = d[k]; });
    ["habitTimes", "doses"].forEach(function (k) { if (!isObj(o[k])) o[k] = d[k]; });
    if (typeof o.backup !== "string") o.backup = d.backup;
    if (!docsOk(o.docs)) o.docs = d.docs;
    if (!isObj(o.health)) o.health = d.health;
    ["stents", "notes"].forEach(function (k) { if (!Array.isArray(o.health[k])) o.health[k] = d.health[k]; });
    ["procedure", "profile"].forEach(function (k) { if (!isObj(o.health[k])) o.health[k] = d.health[k]; });
    return o;
  }
  function save() {
    var s = JSON.stringify(S);
    mem = s;
    try { window.localStorage.setItem(KEY, s); } catch (e) { /* memory only */ }
  }
  function reset() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    mem = null; S = load(); save();
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function newId(list) {
    for (;;) {
      var id = "d" + Date.now().toString(36) + (counter++);
      if (!list.some(function (x) { return x.id === id; })) return id;
    }
  }
  function fail(msg) { return Promise.reject(new Error(msg)); }

  // ---- time helpers (local wall clock) ----
  function pad(n) { return String(n).padStart(2, "0"); }
  function dateKey(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function isTime(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ""); }
  function minuteOf(t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); }
  function parseTime(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(t == null ? "" : t);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error("bad time: " + t);
    return pad(+m[1]) + ":" + pad(+m[2]);
  }
  function isDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function atClock(date, time) { var p = time.split(":"); return new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +p[0], +p[1]).getTime(); }
  // Next occurrence of a daily clock time (minutes since midnight), optionally skipping weekends.
  function nextAt(minutes, weekdaysOnly, now) {
    var n = new Date(now);
    for (var i = 0; i < 9; i++) {
      var c = new Date(n.getFullYear(), n.getMonth(), n.getDate() + i, 0, minutes);
      var wd = c.getDay();
      if (c.getTime() > now && !(weekdaysOnly && (wd === 0 || wd === 6))) return c.getTime();
    }
    return 0;
  }
  function appointmentAt(a) { return atClock(a.date, a.time); }
  function reminderTimes(a, now) {
    if (!isDate(a.date) || !isTime(a.time)) return [];
    var at = appointmentAt(a);
    if (at <= now) return [];
    var eveD = new Date(+a.date.slice(0, 4), +a.date.slice(5, 7) - 1, +a.date.slice(8, 10) - 1, 20, 0).getTime();
    var out = [];
    if (eveD > now) out.push(eveD);
    if (at - 7200000 > now) out.push(at - 7200000);
    return out;
  }

  // ---- medication slots (MedPlan.slots) ----
  function slots() {
    var by = {};
    S.meds.forEach(function (m) {
      (m.times || []).forEach(function (t) {
        if (!isTime(t)) return;
        (by[t] = by[t] || []).push(m);
      });
    });
    return Object.keys(by).sort().map(function (t) {
      var ms = by[t], notes = [];
      ms.forEach(function (m) { if (m.note && notes.indexOf(m.note) < 0) notes.push(m.note); });
      return {
        time: t,
        label: ms.map(function (m) { return m.name; }).join(", "),
        notes: notes.join(", "),
        detail: ms.map(function (m) { return m.dose ? m.name + " " + m.dose : m.name; }).join(", ")
      };
    });
  }
  function taken(date, slot) { var d = S.doses[date]; return !!(d && d[slot]); }
  // WidgetPlan.medState: earliest unmarked past slot, else next today, else (all done) first slot of tomorrow.
  function nextDue(now) {
    var ss = slots(), nm = new Date(now).getHours() * 60 + new Date(now).getMinutes(), dk = dateKey(now), i, s;
    if (!ss.length) return null;
    for (i = 0; i < ss.length; i++) { s = ss[i]; if (!taken(dk, s.time) && minuteOf(s.time) <= nm) return pick(s, false); }
    for (i = 0; i < ss.length; i++) { s = ss[i]; if (!taken(dk, s.time) && minuteOf(s.time) > nm) return pick(s, false); }
    return pick(ss[0], true);
  }
  function pick(s, t) { return { time: s.time, label: s.label, notes: s.notes, taken: t }; }

  // ---- validation (MedPlan / HealthPlan / BpPlan, same order and Turkish text) ----
  function text(o, key, max, label) {
    var v = o[key] == null ? "" : String(o[key]).trim();
    if (v.length > max) throw new Error(label + " en fazla " + max + " karakter olabilir.");
    return v;
  }
  function optDate(o, key, label) {
    var v = text(o, key, 30, label);
    if (v && !isDate(v)) throw new Error("Geçersiz tarih: " + v);
    return v;
  }
  function normMed(i) {
    var name = text(i, "name", 60, "İlaç adı");
    if (!name) throw new Error("İlaç adı boş olamaz.");
    var raw = i.times;
    if (!Array.isArray(raw) || !raw.length) throw new Error("En az bir saat gerekli.");
    var times = [];
    raw.forEach(function (r) {
      var t = r == null ? "" : String(r).trim();
      if (!t) throw new Error("Boş saat var.");
      var n;
      try { n = parseTime(t); } catch (e) { throw new Error("Geçersiz saat: " + t); }
      if (times.indexOf(n) >= 0) throw new Error("Aynı saat iki kez girilmiş: " + n);
      times.push(n);
    });
    return { name: name, dose: text(i, "dose", 30, "Doz"), note: text(i, "note", 120, "Not"), times: times.sort() };
  }
  function phone(i, key) {
    var p = text(i, key, 30, "Telefon");
    if (!PHONE_RE.test(p)) throw new Error("Telefon numarası geçersiz.");
    return p;
  }
  function normDoctor(i) {
    var name = text(i, "name", 60, "Doktor adı");
    if (!name) throw new Error("Doktor adı boş olamaz.");
    var ph = phone(i, "phone");
    return { name: name, specialty: text(i, "specialty", 60, "Branş"), phone: ph, note: text(i, "note", 120, "Not") };
  }
  function normStent(i) {
    var vessel = text(i, "vessel", 120, "Damar");
    if (!vessel) throw new Error("Damar boş olamaz.");
    return { vessel: vessel, segment: text(i, "segment", 120, "Bölüm"), diameter: text(i, "diameter", 30, "Çap"),
      length: text(i, "length", 30, "Uzunluk"), model: text(i, "model", 120, "Model"), code: text(i, "code", 30, "Ürün kodu") };
  }
  function normProcedure(i) {
    return { date: optDate(i, "date", "İşlem tarihi"), hospital: text(i, "hospital", 120, "Hastane"), doctor: text(i, "doctor", 120, "Doktor"),
      access: text(i, "access", 120, "Giriş yeri"), summary: text(i, "summary", 300, "Sonuç") };
  }
  function normProfile(i) {
    var blood = text(i, "bloodType", 30, "Kan grubu");
    if (BLOOD.indexOf(blood) < 0) throw new Error("Geçersiz kan grubu.");
    var ph = phone(i, "emergencyPhone");
    return { name: text(i, "name", 120, "Ad soyad"), birthDate: optDate(i, "birthDate", "Doğum tarihi"), bloodType: blood,
      allergies: text(i, "allergies", 300, "Alerjiler"), emergencyName: text(i, "emergencyName", 120, "Acil kişi"), emergencyPhone: ph,
      diagnoses: text(i, "diagnoses", 300, "Tanılar"), heart: text(i, "heart", 300, "Kalp fonksiyonu") };
  }
  function normNote(i) {
    var title = text(i, "title", 120, "Başlık");
    if (!title) throw new Error("Başlık boş olamaz.");
    var tx = text(i, "text", 2000, "Metin");
    if (!tx) throw new Error("Metin boş olamaz.");
    return { title: title, text: tx };
  }
  function normAppt(i) {
    var date = text(i, "date", 30, "Tarih");
    if (!date) throw new Error("Randevu tarihi gerekli.");
    if (!isDate(date)) throw new Error("Geçersiz tarih: " + date);
    var time = text(i, "time", 30, "Saat");
    if (!time) throw new Error("Randevu saati gerekli.");
    var n;
    try { n = parseTime(time); } catch (e) { throw new Error("Geçersiz saat: " + time); }
    return { date: date, time: n, doctorId: text(i, "doctorId", 120, "Doktor"), place: text(i, "place", 120, "Yer"), note: text(i, "note", 300, "Not") };
  }
  function idOf(i) { return i.id == null ? "" : String(i.id); }
  function upsert(list, item, id) {
    if (!id) id = newId(list);
    item.id = id;
    var at = list.findIndex(function (x) { return x.id === id; });
    if (at >= 0) list[at] = item; else list.push(item);
    return item;
  }
  function remove(list, id) {
    var at = id == null ? -1 : list.findIndex(function (x) { return x.id === id; });
    if (at < 0) return false;
    list.splice(at, 1);
    return true;
  }
  function newRc(list) {
    for (var rc = 1; rc <= MAX_RC; rc++) if (!list.some(function (a) { return a.rc === rc; })) return rc;
    throw new Error("Çok fazla randevu var.");
  }

  // ---- state (RitimPlugin.state) ----
  var HABITS = [
    { id: "h1", weekdaysOnly: false, title: "Sabah kahvesi sigarasız" },
    { id: "h2", weekdaysOnly: true, title: "Öğle arası — 10 dk yürü" },
    { id: "h3", weekdaysOnly: true, title: "Stres saati" },
    { id: "h4", weekdaysOnly: false, title: "Eve geliş — bugünü kaybetme" }
  ];
  function state() {
    var now = Date.now(), o = {};
    o.reminders = HABITS.map(function (h) {
      var t = S.habitTimes[h.id];
      return { id: h.id, time: t, med: false, weekdaysOnly: h.weekdaysOnly, title: h.title, body: null,
        next: nextAt(minuteOf(t), h.weekdaysOnly, now), nextExact: true, followUpAt: 0 };
    });
    o.slots = slots().map(function (s) {
      s.next = nextAt(minuteOf(s.time), false, now); s.nextExact = true; s.followUpAt = 0;
      return s;
    });
    o.meds = copy(S.meds); o.doctors = copy(S.doctors); o.legacyMap = {}; o.doses = copy(S.doses);
    o.health = copy(S.health);
    o.appointments = S.appointments.map(function (a) {
      var x = copy(a), valid = isDate(a.date) && isTime(a.time), r = valid ? reminderTimes(a, now) : [];
      var d = S.doctors.filter(function (y) { return y.id === a.doctorId; })[0];
      x.at = valid ? appointmentAt(a) : 0;
      x.nextReminderAt = r.length ? r[0] : 0;
      x.doctorName = d ? d.name : "";
      return x;
    });
    o.backup = S.backup || ""; o.onboarded = !!S.onboarded; o.version = VERSION; o.updatedAt = S.createdAt;
    o.bp = { times: S.bpTimes.slice(), next: S.bpTimes.map(function (t) { return { time: t, at: nextAt(minuteOf(t), false, now), exact: true }; }) };
    o.status = { notifications: "granted", notificationsEnabled: true, medsChannel: true, habitsChannel: true, exactAlarms: true,
      batteryUnrestricted: true, medsUnreadable: false, healthUnreadable: false, sdk: 37, manufacturer: "google", testAckAt: S.testAckAt || 0, now: now };
    return o;
  }

  // Validate + apply, persist, resolve with fresh state; thrown messages become rejections.
  function mutate(fn) {
    try { fn(); } catch (e) { return fail(e.message); }
    save();
    return Promise.resolve(state());
  }
  function write(call, key, fn) {
    var v = call && call[key];
    if (v == null || typeof v !== "object" || Array.isArray(v)) return fail("Bilgi eksik.");
    return mutate(function () { fn(v); });
  }

  function emit(name, data) {
    (listeners[name] || []).slice().forEach(function (fn) { setTimeout(function () { try { fn(data || {}); } catch (e) { console.error(e); } }, 0); });
  }
  function setDose(date, slot, on) {
    S.doses[date] = S.doses[date] || {};
    S.doses[date][slot] = on ? 1 : 0; // the native store keeps a 0, not a delete
    save();
    emit("doseChanged", { date: date, slot: slot, taken: !!on });
  }

  // ---- health (HealthReader / AlarmReceiver) ----
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function healthStatus() {
    var h = window.DEMO_DATA.healthStatus();
    h.walkCheck = !!S.walkCheck;
    h.walkCheckAt = S.walkCheck ? nextAt(minuteOf(S.habitTimes.h2) + 90, true, Date.now()) : 0;
    return h;
  }
  function metrics() { return window.DEMO_DATA.metrics(Date.now()); }
  // WalkRule.decide on the sample data: a finished walk today means WALKED.
  function walkDecision(now) {
    var w = window.DEMO_DATA.metrics(now).today.walks[0];
    if (!w) return { decision: "NOT_WALKED", reason: "" };
    return { decision: "WALKED", reason: w.minutes + " dk yürüyüş (" + hhmm(w.start) + ")" };
  }
  function bpDecision(now) {
    var r = window.DEMO_DATA.metrics(now).bp.readings;
    return r.some(function (x) { return x.time >= now - 3600000 && x.time <= now; }) ? "MEASURED" : "NOT_MEASURED";
  }
  var TEST_TEXT = {
    med: { kind: "test-med", channel: "meds", title: "Test: ilaç bildirimi", body: "Aldım'a dokun — uygulama açılmadan işaretlenmeli" },
    habit: { kind: "test-habit", channel: "habits", title: "Test: alışkanlık bildirimi", body: "Sessiz kanal" }
  };
  function bpRow(r) {
    var sys = Number(r.sys), dia = Number(r.dia), pulse = r.pulse == null ? null : Number(r.pulse), time = Number(r.time);
    var ok = isFinite(time) && time > 0 && isFinite(sys) && isFinite(dia) && sys >= 40 && sys <= 300 && dia >= 20 && dia <= 200 &&
      (pulse === null || (pulse >= 20 && pulse <= 250));
    if (!ok) throw new Error("Geçersiz ölçüm satırı.");
    return { time: time, sys: sys, dia: dia, pulse: pulse };
  }
  function avg(v) { return Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length + 1e-9); }
  function bpSummary(rows) {
    var p = rows.map(function (r) { return r.pulse; }).filter(function (x) { return x !== null; });
    var sy = rows.map(function (r) { return r.sys; }), di = rows.map(function (r) { return r.dia; });
    return { count: rows.length, sysAvg: avg(sy), diaAvg: avg(di), pulseAvg: p.length ? avg(p) : null,
      sysMin: Math.min.apply(null, sy), sysMax: Math.max.apply(null, sy), diaMin: Math.min.apply(null, di), diaMax: Math.max.apply(null, di) };
  }
  function dmy(k) { return k.slice(8, 10) + "." + k.slice(5, 7) + "." + k.slice(0, 4); }

  // ---- widget and notification texts (WidgetPlan, StreakMath, Widgets, Notifier) ----
  function widgetState(ss, takenToday, nowMinute) {
    var t = function (s) { return takenToday.indexOf(s.time) >= 0; }, i, s, m;
    if (!ss.length) return { kind: "EMPTY", time: null, names: null, canTake: false, tomorrow: null };
    for (i = 0; i < ss.length; i++) { s = ss[i]; if (!t(s) && minuteOf(s.time) <= nowMinute) return { kind: "DUE", time: s.time, names: s.names, canTake: true, tomorrow: null }; }
    for (i = 0; i < ss.length; i++) {
      s = ss[i]; m = minuteOf(s.time);
      if (!t(s) && m > nowMinute) return { kind: "NEXT", time: s.time, names: s.names, canTake: m - nowMinute <= 60, tomorrow: null };
    }
    return { kind: "DONE", time: null, names: null, canTake: false, tomorrow: ss[0].time };
  }
  function medWidget(st) {
    var o = st.kind === "DUE" ? ["Şimdi alınacak", st.time, st.names] : st.kind === "NEXT" ? ["Sıradaki ilaç", st.time, st.names]
      : st.kind === "DONE" ? ["Bugünkü ilaçlar", "Tamam ✓", "yarın " + st.tomorrow] : ["İlaçlar", "—", "İlaç eklemek için dokun"];
    return { k: o[0], time: o[1], names: o[2], canTake: !!st.canTake };
  }
  function medWidgetNow(now) {
    var dk = dateKey(now), d = new Date(now);
    var ss = slots().map(function (s) { return { time: s.time, names: s.label }; });
    var st = widgetState(ss, ss.filter(function (s) { return taken(dk, s.time); }).map(function (s) { return s.time; }), d.getHours() * 60 + d.getMinutes());
    var w = medWidget(st);
    w.slot = st.canTake ? st.time : null; w.date = dk;
    return w;
  }
  function streak(backupJson, field, todayKey) {
    var days;
    try { days = JSON.parse(backupJson || "").days; } catch (e) { return 0; }
    if (!days || typeof days !== "object") return 0;
    var d = new Date(+todayKey.slice(0, 4), +todayKey.slice(5, 7) - 1, +todayKey.slice(8, 10)), n = 0;
    var marked = function () { var e = days[dateKey(d.getTime())]; return !!(e && +e[field]); };
    if (!marked()) d.setDate(d.getDate() - 1);
    while (n < 400 && marked()) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function fmtSteps(n) { return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function whenText(ms, now) {
    var DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
    return (dateKey(ms) === dateKey(now) ? "bugün" : DAYS[new Date(ms).getDay()]) + " " + hhmm(ms);
  }
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  var WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  // Everything the home screen shows; `key` lets the UI skip rebuilding (and losing focus) when nothing changed.
  function homeView(now) {
    var d = new Date(now), v = { clock: hhmm(now), date: d.getDate() + " " + MONTHS[d.getMonth()] + " " + WEEKDAYS[d.getDay()],
      med: medWidgetNow(now), sum: widgetSummary(now) };
    v.key = JSON.stringify([v.clock, v.date, v.med, v.sum]);
    return v;
  }
  function widgetSummary(now) {
    var m = window.DEMO_DATA.metrics(now), r = m.bp.readings.filter(function (x) { return x.time > now - 7 * 86400000 && x.time <= now; });
    var bp = r.length ? r.reduce(function (a, b) { return b.time > a.time ? b : a; }) : null;
    var walked = m.today.walks.some(function (w) { return w.minutes >= 10; });
    var s = streak(S.backup, "s", dateKey(now)), a = streak(S.backup, "a", dateKey(now));
    return { bp: bp ? "Tansiyon " + bp.sys + "/" + bp.dia + " · " + whenText(bp.time, now) : "Tansiyon · veri yok",
      steps: "Adım " + fmtSteps(m.today.steps) + (walked ? " · yürüyüş ✓" : ""),
      quit: "Sigarasız " + (s > 0 ? s + " gün" : "başlamadı") + " · Alkolsüz " + (a > 0 ? a + " gün" : "başlamadı") };
  }
  // Closest clock time of the day (the alarm the demo pretends just fired).
  function nearest(times, nm) {
    return times.slice().sort(function (x, y) { return Math.abs(minuteOf(x) - nm) - Math.abs(minuteOf(y) - nm) || minuteOf(x) - minuteOf(y); })[0];
  }
  function doseText(slot) {
    var s = slots().filter(function (x) { return x.time === slot; })[0];
    if (!s) return null;
    return s.detail + (s.notes ? "\n" + s.notes : "");
  }
  // Menu item → notification spec (Notifier texts) or {toast}.
  function notification(kind, now, lastSlot) {
    var d = new Date(now), nm = d.getHours() * 60 + d.getMinutes(), due, t;
    if (kind === "med") {
      due = nextDue(now);
      if (!due || due.taken) return { toast: "Bugünkü ilaçlar tamam." };
      return { kind: "med", title: "İlaç zamanı · " + due.time, body: doseText(due.time), slot: due.time };
    }
    if (kind === "followup") {
      t = lastSlot && doseText(lastSlot) !== null ? lastSlot : (due = nextDue(now)) && !due.taken ? due.time : null;
      if (!t || taken(dateKey(now), t)) return { toast: "Bu doz zaten işaretli — tekrar gelmez." };
      return { kind: "followup", title: "Hatırlatma · İlaç zamanı · " + t, body: "Henüz işaretlenmedi · " + doseText(t), slot: t };
    }
    if (kind === "habit") {
      var wd = d.getDay(), hs = HABITS.filter(function (h) { return !(h.weekdaysOnly && (wd === 0 || wd === 6)); });
      var near = nearest(hs.map(function (h) { return S.habitTimes[h.id]; }), nm);
      return { kind: "habit", title: hs.filter(function (h) { return S.habitTimes[h.id] === near; })[0].title, body: "" };
    }
    if (kind === "bp") {
      t = S.bpTimes.length ? nearest(S.bpTimes, nm) : hhmm(now);
      return { kind: "bp", title: "Tansiyon ölçme zamanı · " + t, body: "" };
    }
    if (kind === "appt") {
      var list = S.appointments.filter(function (a) { return isDate(a.date) && isTime(a.time); })
        .sort(function (x, y) { return appointmentAt(x) - appointmentAt(y); });
      var a = list.filter(function (x) { return appointmentAt(x) > now; })[0] || list[list.length - 1];
      if (!a) return { toast: "Kayıtlı randevu yok." };
      var doc = S.doctors.filter(function (y) { return y.id === a.doctorId; })[0], parts = [];
      if (doc && doc.name) parts.push(doc.name);
      if (a.place) parts.push(a.place);
      var body = parts.join(" · ");
      if (a.note) body = body ? body + "\n" + a.note : a.note;
      return { kind: "appt", title: "Kontrol randevusu 2 saat sonra · " + a.time, body: body };
    }
    return null;
  }
  function testFollowUp() {
    var x = TEST_TEXT.med;
    return { kind: "test-med", repeat: true, title: "Hatırlatma · " + x.title, body: "Henüz işaretlenmedi · " + x.body };
  }

  // ---- documents (DocPlan / DocumentStore) ----
  var CATEGORIES = ["rapor", "anjiyo", "diger"];
  var session = []; // imported this visit; blob URLs do not survive a reload, so they stay out of storage
  var MIME = { svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", pdf: "application/pdf" };
  function extOf(n) { var m = /\.([A-Za-z0-9]+)$/.exec(n || ""); return m ? m[1].toLowerCase() : ""; }
  function kindOf(f) {
    var t = f.type || MIME[extOf(f.name)] || "";
    return t.indexOf("image/") === 0 ? "image" : t.indexOf("video/") === 0 ? "video" : t === "application/pdf" ? "pdf" : "";
  }
  function allDocs() { return S.docs.concat(session); }
  function findDoc(id) { var l = allDocs().filter(function (d) { return d.id === id; }); return l.length ? l[0] : null; }
  function sortedDocs() {
    return allDocs().slice().sort(function (a, b) {
      var ca = CATEGORIES.indexOf(a.category), cb = CATEGORIES.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      if (a.category === "rapor") {
        if ((a.date || "") !== (b.date || "")) return !a.date ? 1 : !b.date ? -1 : a.date < b.date ? 1 : -1;
        return b.addedAt - a.addedAt;
      }
      return a.category === "anjiyo" ? a.addedAt - b.addedAt : b.addedAt - a.addedAt;
    });
  }
  function docsState() {
    var list = sortedDocs().map(function (d) { var x = copy(d); delete x._key; return x; });
    return { docs: list, totalBytes: list.reduce(function (n, d) { return n + (d.size || 0); }, 0), freeBytes: 4e9, seedPending: false, importing: false };
  }
  // Hidden file input created per call; resolves with the chosen files ([] on cancel).
  function pickFiles(o) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input"), done = false, timer = 0;
      inp.type = "file"; inp.multiple = !o.capture; inp.accept = o.accept; inp.style.display = "none";
      inp.setAttribute("accept", o.accept);
      if (o.folder) { inp.webkitdirectory = true; inp.setAttribute("webkitdirectory", ""); }
      if (o.capture) inp.setAttribute("capture", "environment");
      function finish(files) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (window.removeEventListener) window.removeEventListener("focus", onFocus);
        if (inp.remove) inp.remove();
        resolve(files);
      }
      // iOS Safari fires no change/cancel on dismissal: when the page regains focus with nothing chosen, treat it as cancel.
      function onFocus() { timer = setTimeout(function () { finish(inp.files && inp.files.length ? Array.prototype.slice.call(inp.files) : []); }, 1500); }
      inp.addEventListener("change", function () { finish(Array.prototype.slice.call(inp.files || [])); });
      inp.addEventListener("cancel", function () { finish([]); });
      if (window.addEventListener) window.addEventListener("focus", onFocus);
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function importResult(r) {
    var o = docsState();
    o.added = r.added; o.skipped = r.skipped; o.failed = 0; o.unsupported = r.unsupported; o.lastCategory = r.lastCategory;
    return o;
  }
  function importFrom(o) {
    return pickFiles(o).then(function (files) {
      var r = { added: 0, skipped: 0, unsupported: 0, lastCategory: "" }, total = files.length, seen = {};
      allDocs().forEach(function (d) { if (d._key) seen[d._key] = 1; });
      // One macrotask per file: emit() defers with setTimeout(0), so progress reaches listeners in order and the
      // overlay can paint; the result resolves only after the last event was delivered.
      function tick() { return new Promise(function (res) { setTimeout(res, 0); }); }
      function step(i) {
        if (i >= files.length) {
          if (r.added) emit("documentsChanged", {});
          return tick().then(function () { return importResult(r); });
        }
        var f = files[i], kind = kindOf(f), k = f.name + "|" + f.size + "|" + f.lastModified;
        if (!kind) r.unsupported++;
        else if (seen[k]) r.skipped++;
        else {
          seen[k] = 1;
          var url = URL.createObjectURL(f), cat = kind === "video" ? "anjiyo" : "rapor";
          session.push({ id: newId(allDocs()), title: o.title || f.name.replace(/\.[^.]*$/, ""), category: cat, date: "", note: "", kind: kind, file: f.name,
            thumb: "", size: f.size || 0, addedAt: Date.now(), url: url, thumbUrl: kind === "image" ? url : "", missing: false, _key: k });
          r.added++; r.lastCategory = cat;
        }
        emit("importProgress", { done: i + 1, total: total, name: f.name });
        return tick().then(function () { return step(i + 1); });
      }
      return step(0);
    });
  }
  function revoke(d) {
    if (d.url && d.url.indexOf("blob:") === 0) { URL.revokeObjectURL(d.url); if (d.thumbUrl && d.thumbUrl !== d.url) URL.revokeObjectURL(d.thumbUrl); }
  }
  function docEdit(i) {
    var title = text(i, "title", 120, "Başlık");
    if (!title) throw new Error("Başlık boş olamaz.");
    var cat = text(i, "category", 20, "Kategori");
    if (CATEGORIES.indexOf(cat) < 0) throw new Error("Geçersiz kategori.");
    return { title: title, category: cat, date: optDate(i, "date", "Tarih"), note: text(i, "note", 500, "Not") };
  }

  S = load(); save();

  // closing brace at column 0: scripts/build-demo.mjs parses this block
  const METHODS = {
    consumeLaunch() { return Promise.resolve({ action: "" }); },
    getState() { return Promise.resolve(state()); },
    setTimes(call) {
      var times = call && call.times;
      if (times == null || typeof times !== "object") return fail("times required");
      return mutate(function () {
        var ups = Object.keys(times).map(function (id) {
          if (!S.habitTimes.hasOwnProperty(id)) throw new Error("unknown reminder: " + id);
          return [id, parseTime(times[id])];
        });
        ups.forEach(function (u) { S.habitTimes[u[0]] = u[1]; });
      });
    },
    saveMed(call) {
      var m = call && call.med;
      if (m == null || typeof m !== "object") return fail("İlaç bilgisi eksik.");
      return mutate(function () { upsert(S.meds, normMed(m), idOf(m)); });
    },
    deleteMed(call) { return remove(S.meds, call && call.id) ? mutate(function () {}) : fail("İlaç bulunamadı."); },
    saveDoctor(call) {
      var d = call && call.doctor;
      if (d == null || typeof d !== "object") return fail("Doktor bilgisi eksik.");
      return mutate(function () { upsert(S.doctors, normDoctor(d), idOf(d)); });
    },
    deleteDoctor(call) { return remove(S.doctors, call && call.id) ? mutate(function () {}) : fail("Doktor bulunamadı."); },
    saveStent(call) { return write(call, "stent", function (v) { upsert(S.health.stents, normStent(v), idOf(v)); }); },
    deleteStent(call) { return remove(S.health.stents, call && call.id) ? mutate(function () {}) : fail("Stent bulunamadı."); },
    saveNote(call) { return write(call, "note", function (v) { upsert(S.health.notes, normNote(v), idOf(v)); }); },
    deleteNote(call) { return remove(S.health.notes, call && call.id) ? mutate(function () {}) : fail("Kart bulunamadı."); },
    saveProcedure(call) { return write(call, "procedure", function (v) { S.health.procedure = normProcedure(v); }); },
    saveProfile(call) { return write(call, "profile", function (v) { S.health.profile = normProfile(v); }); },
    saveAppointment(call) {
      return write(call, "appointment", function (v) {
        var item = normAppt(v), id = idOf(v), old = S.appointments.filter(function (a) { return id && a.id === id; })[0];
        item.rc = old && old.rc ? old.rc : newRc(S.appointments);
        upsert(S.appointments, item, id);
      });
    },
    deleteAppointment(call) { return remove(S.appointments, call && call.id) ? mutate(function () {}) : fail("Randevu bulunamadı."); },
    saveBpTimes(call) {
      return mutate(function () {
        var raw = call && Array.isArray(call.times) ? call.times : []; // native: missing/non-array = empty
        if (raw.length > 6) throw new Error("En fazla 6 ölçüm saati eklenebilir.");
        var seen = [];
        raw.forEach(function (t) {
          if (!isTime(t)) throw new Error("Geçersiz saat: " + t);
          if (seen.indexOf(t) >= 0) throw new Error("Bu saat zaten var: " + t);
          seen.push(t);
        });
        S.bpTimes = seen.sort();
      });
    },
    setDose(call) {
      var date = call && call.date, slot = call && call.slot, on = call && call.taken;
      if (date == null || !isTime(slot) || typeof on !== "boolean") return fail("bad dose");
      S.doses[date] = S.doses[date] || {};
      S.doses[date][slot] = on ? 1 : 0;
      save();
      return Promise.resolve();
    },
    backup(call) { if (call && call.json != null) { S.backup = String(call.json); save(); } return Promise.resolve(); },
    markOnboarded() { S.onboarded = true; save(); return Promise.resolve(); },
    setWalkCheck(call) {
      S.walkCheck = !(call && call.enabled === false);
      save();
      return Promise.resolve(healthStatus());
    },
    healthStatus() { return Promise.resolve(healthStatus()); },
    requestHealthPermissions() { window.RitimDemo.toast(SETTINGS_NOTE); return Promise.resolve(healthStatus()); },
    openHealthSettings() { window.RitimDemo.toast(SETTINGS_NOTE); return Promise.resolve({ opened: true }); },
    getMetrics() { return Promise.resolve(metrics()); },
    getDay(call) {
      var d = window.DEMO_DATA.day(call && call.date, Date.now());
      return d ? Promise.resolve(d) : fail("Bu tarih için veri gösterilmiyor.");
    },
    testWalkCheck() {
      var r = walkDecision(Date.now());
      window.RitimDemo.notify(r.decision === "WALKED" ? { kind: "walk", channel: "habits", title: "✓ Bugün yürüdün", body: r.reason }
        : { kind: "walk", channel: "habits", title: "Öğle yürüyüşü", body: "Bugün henüz 10 dakikalık bir yürüyüş görünmüyor." });
      return Promise.resolve(r);
    },
    testBpCheck() {
      var now = Date.now(), dec = bpDecision(now);
      window.RitimDemo.notify({ kind: "bp", channel: "habits", time: hhmm(now),
        title: dec === "MEASURED" ? "✓ Son bir saatte tansiyon ölçümü var" : "Tansiyon ölçme zamanı · " + hhmm(now), body: "" });
      return Promise.resolve({ decision: dec });
    },
    scheduleTest(call) {
      var kind = call && call.kind === "habit" ? "habit" : "med";
      var secs = Math.max(5, call && call.seconds != null ? Math.floor(Number(call.seconds)) || 0 : 120);
      var at = Date.now() + secs * 1000;
      var t = setTimeout(function () { window.RitimDemo.notify(copy(TEST_TEXT[kind])); }, secs * 1000);
      if (t && t.unref) t.unref();
      return Promise.resolve({ at: at, exact: true });
    },
    makeBpReport(call) {
      try {
        var raw = call && call.rows;
        if (!Array.isArray(raw) || !raw.length || raw.length > 2000) throw new Error("Bu dönemde ölçüm yok.");
        var rows = raw.map(bpRow), from = call.from, to = call.to;
        if (!isDate(from) || !isDate(to)) throw new Error("Rapor oluşturulamadı.");
        var name = from.slice(0, 4) === to.slice(0, 4) ? from.slice(8, 10) + "." + from.slice(5, 7) : dmy(from);
        window.RitimDemo.openReport({ title: "Tansiyon " + name + "–" + dmy(to) + ".pdf", from: from, to: to, rows: rows, summary: bpSummary(rows),
          name: (S.health.profile && S.health.profile.name || "").trim(), period: dmy(from) + " – " + dmy(to), source: (call && call.source) || "Omron" });
      } catch (e) { return fail(e.message); }
      return Promise.resolve({ opened: true });
    },
    getDocuments() { return Promise.resolve(docsState()); },
    importFiles() { return importFrom({ accept: "image/*,video/*,application/pdf" }); },
    importFolder() { return importFrom({ accept: "image/*,video/*,application/pdf", folder: true }); },
    takePhoto() {
      var d = new Date();
      return importFrom({ accept: "image/*", capture: true, title: "Fotoğraf " + dateKey(d) + " " + pad(d.getHours()) + "." + pad(d.getMinutes()) });
    },
    updateDocument(call) {
      var doc = call && call.doc;
      if (doc == null || typeof doc !== "object") return fail("Bilgi eksik.");
      var d, e;
      try { e = docEdit(doc); d = findDoc(idOf(doc)); if (!d) throw new Error("Belge bulunamadı."); } catch (x) { return fail(x.message); }
      d.title = e.title; d.category = e.category; d.date = e.date; d.note = e.note;
      save();
      return Promise.resolve(docsState());
    },
    deleteDocument(call) {
      var id = call && call.id, d = id == null ? null : findDoc(id);
      if (!d) return fail("Belge bulunamadı.");
      revoke(d);
      remove(S.docs, id); remove(session, id);
      save();
      return Promise.resolve(docsState());
    },
    shareDocument(call) {
      var d = findDoc(call && call.id);
      if (!d) return fail("Belge bulunamadı.");
      var ext = extOf(d.file), name = d.title + (ext ? "." + ext : "");
      return fetch(d.url).then(function (r) { return r.blob(); }).then(function (b) {
        var f = new File([b], name, { type: b.type || MIME[ext] || "application/octet-stream" });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          return navigator.share({ files: [f], title: d.title }).then(function () { return { opened: true }; }, function (e) {
            if (!(e && e.name === "AbortError")) window.RitimDemo.toast("Bu tarayıcı paylaşımı desteklemiyor.");
            return { opened: true };
          });
        }
        window.RitimDemo.toast("Bu tarayıcı paylaşımı desteklemiyor.");
        return { opened: false };
      }).catch(function () { window.RitimDemo.toast("Bu tarayıcı paylaşımı desteklemiyor."); return { opened: false }; });
    },
    openDocument(call) {
      var d = findDoc(call && call.id);
      if (!d) return fail("Belge bulunamadı.");
      if (!window.open(d.url, "_blank")) window.RitimDemo.toast("Belge açılamadı; tarayıcı açılır pencereyi engelledi.");
      return Promise.resolve({ opened: true });
    },
    requestNotifications() { window.RitimDemo.toast(SETTINGS_NOTE); return Promise.resolve(state()); },
    openSettings() { window.RitimDemo.toast(SETTINGS_NOTE); return Promise.resolve({ opened: true }); },
    addListener(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return Promise.resolve({ remove() { var l = listeners[name] || [], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } });
    },
};
  const EVENTS = ["doseChanged", "openTab", "documentsChanged", "importProgress", "resume", "openCard", "openPrivacy"];

  window.RitimDemo = {
    emit: emit, store: function () { return S; }, save: save, reset: reset, slots: slots, nextDue: nextDue, setDose: setDose,
    widgetState: widgetState, medWidget: medWidget, medWidgetNow: medWidgetNow, streak: streak, fmtSteps: fmtSteps, whenText: whenText,
    widgetSummary: widgetSummary, homeView: homeView, notification: notification, testFollowUp: testFollowUp, dateKey: dateKey,
    toast: function (t) { console.info(t); }, notify: function () {}, openReport: function () {}, events: EVENTS
  };
  // Runs before the app's own popstate listener (demo.js loads in <head>): a demo layer (home screen, report)
  // closes on back/swipe-back without the app also closing its top sheet.
  if (window.addEventListener) window.addEventListener("popstate", function (e) {
    var h = window.RitimDemo.onPopState;
    if (h && h(e)) e.stopImmediatePropagation();
  });
  window.Capacitor = { isNativePlatform() { return true; }, Plugins: { Ritim: METHODS } };
})();
