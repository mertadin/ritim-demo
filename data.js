// Fictional, deterministic sample data for the Ritim web demo. No real records.
(function () {
  "use strict";
  var DAY = 86400000;
  var PERMS = ["steps", "exercise", "heartRate", "restingHr", "hrv", "resp", "sleep", "bp"];
  var MAX_BACK = 89; // same window as DayRange.MAX_DAYS_BACK

  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = fnv(seed); return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function key(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; } // local wall clock
  function parseKey(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return null; var d = new Date(+m[1], +m[2] - 1, +m[3]); return key(d) === s ? d : null; }
  function between(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function at(d, h, m) { var x = new Date(d.getTime()); x.setHours(h, m, 0, 0); return x.getTime(); }

  // Everything for one local day, seeded by the date so metrics() and day() agree.
  function dayVals(d) {
    var k = key(d), r = rng("ritim-demo|" + k);
    var dn = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
    var weekend = d.getDay() === 0 || d.getDay() === 6;
    var v = {
      key: k,
      steps: weekend ? between(r, 4500, 7000) : between(r, 5500, 9500),
      restingHr: between(r, 58, 66),
      hrMin: between(r, 52, 58),
      hrMax: between(r, 96, 128),
      hrv: between(r, 28, 45),
      resp: Math.round((13 + r() * 3) * 10) / 10
    };
    var walkMin = between(r, 18, 45), walkAt = between(r, 12 * 60 + 15, 13 * 60 + 10);
    v.walk = dn % 5 === 0 ? null : { start: at(d, 0, 0) + walkAt * 60000, minutes: walkMin, kind: "walk" };
    var minutes = between(r, 370, 470), wake = between(r, 6 * 60 + 30, 7 * 60 + 10);
    var deep = Math.round(minutes * (0.15 + r() * 0.05)), rem = Math.round(minutes * (0.20 + r() * 0.05)), awake = Math.round(minutes * 0.05);
    var end = at(d, 0, 0) + wake * 60000;
    v.sleep = { date: k, start: end - minutes * 60000, end: end, minutes: minutes, stages: { deep: deep, light: minutes - deep - rem - awake, rem: rem, awake: awake } };
    var br = rng("ritim-demo|bp|" + k), which = br(); // most days two readings, some one
    v.bp = [];
    [[8 * 60 + 15, which < 0.85], [20 * 60 + 10, which >= 0.15]].forEach(function (s) {
      var sys = between(br, 112, 132), dia = between(br, 70, 84), pulse = between(br, 58, 72), jitter = between(br, -12, 12);
      if (s[1]) v.bp.push({ time: at(d, 0, 0) + (s[0] + jitter) * 60000, sys: sys, dia: dia, pulse: pulse, source: "OMRON connect" });
    });
    return v;
  }

  // Steps so far today follow the (whole) hour so repeated calls within the hour match.
  function stepsOn(v, isToday, now) {
    if (!isToday) return v.steps;
    return Math.floor(v.steps * Math.max(0, Math.min(1, (new Date(now).getHours() - 7) / 14)));
  }
  function walksOn(v, isToday, now) {
    if (!v.walk) return [];
    if (isToday && v.walk.start + v.walk.minutes * 60000 > now) return [];
    return [copy(v.walk)];
  }

  function healthStatus() { return { sdk: "available", linked: true, granted: PERMS.slice(), missing: [], background: true }; }

  function metrics(now) {
    var today = dayStart(now), tk = key(today), out = { status: healthStatus() };
    var steps7 = [], rest = [], hrv = [], resp = [], nights = [], bp = [], i, d, v;
    var walks = [];
    for (i = MAX_BACK; i >= 0; i--) {
      d = addDays(today, -i); v = dayVals(d);
      var isToday = v.key === tk;
      if (i <= 7) steps7.push({ date: v.key, value: stepsOn(v, isToday, now) });
      if (i <= 29) rest.push({ date: v.key, value: v.restingHr });
      if (i <= 13) {
        hrv.push({ date: v.key, value: v.hrv }); resp.push({ date: v.key, value: v.resp });
        if (v.sleep.end <= now) nights.push(v.sleep);
      }
      v.bp.forEach(function (b) { if (b.time <= now) bp.push(b); });
      if (isToday) walks = walksOn(v, true, now);
    }
    var tv = dayVals(today);
    out.today = { steps: steps7[steps7.length - 1].value, steps7: steps7, walks: walks };
    out.restingHr = { days: rest };
    out.heart = { hrMin: tv.hrMin, hrMax: tv.hrMax, hrv: hrv, resp: resp };
    out.sleep = { nights: nights };
    out.bp = { readings: bp, sources: ["OMRON connect"] };
    out.lastDataAt = Math.floor(now / 300000) * 300000;
    out.denied = [];
    return out;
  }

  // null = the real plugin rejects ("Bu tarih için veri gösterilmiyor.")
  function day(date, now) {
    var d = parseKey(date), today = dayStart(now);
    if (!d || d.getTime() > today.getTime() || d.getTime() < addDays(today, -MAX_BACK).getTime()) return null;
    var v = dayVals(d), isToday = v.key === key(today);
    var out = { date: v.key, status: healthStatus(), steps: stepsOn(v, isToday, now), walks: walksOn(v, isToday, now),
      restingHr: v.restingHr, hrMin: v.hrMin, hrMax: v.hrMax, hrv: v.hrv, resp: v.resp };
    if (v.sleep.end <= now) out.sleep = { minutes: v.sleep.minutes, start: v.sleep.start, end: v.sleep.end, stages: copy(v.sleep.stages) };
    out.bp = v.bp.filter(function (b) { return b.time <= now; });
    out.denied = [];
    return out;
  }

  // Sample documents: hand-made SVGs and one synthetic video under docs/. Dates sit around the procedure date.
  function docList(proc, now) {
    var p = parseKey(proc);
    function doc(n, title, cat, date, note, kind, file, size, extra) {
      var o = { id: "doc-demo-" + n, title: title, category: cat, date: date, note: note, kind: kind, file: file, thumb: file.replace(/\.mp4$/, ".svg"),
        size: size, addedAt: now - n * 1000, url: "docs/" + file, thumbUrl: "docs/thumbs/" + file.replace(/\.mp4$/, ".svg"), missing: false };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      return o;
    }
    return [
      doc(1, "Taburculuk özeti (epikriz)", "rapor", proc, "Örnek belge", "image", "rapor-epikriz.svg", 2808),
      doc(2, "EKG", "rapor", key(addDays(p, -1)), "Örnek belge", "image", "rapor-ekg.svg", 4716),
      doc(3, "Ekokardiyografi", "rapor", key(addDays(p, 1)), "Örnek belge", "image", "rapor-eko.svg", 3361),
      doc(4, "Hemogram ve lipid paneli", "diger", key(addDays(p, -1)), "Örnek belge", "image", "tahlil-kan.svg", 3964),
      doc(5, "Biyokimya paneli", "diger", key(addDays(p, 30)), "Örnek belge", "image", "tahlil-biyokimya.svg", 3906),
      doc(6, "Örnek anjiyo kaydı", "anjiyo", proc, "Yapay animasyon", "video", "anjiyo-ornek.mp4", 43004, { durationMs: 4000 })
    ];
  }

  function seed() {
    var today = dayStart(Date.now());
    var procDate = key(addDays(today, -120)), apptDate = key(addDays(today, 9));
    var meds = [
      { id: "med-panto", name: "Panto", dose: "40 mg", note: "aç", times: ["08:00"] },
      { id: "med-coraspin", name: "Coraspin", dose: "100 mg", note: "tok", times: ["08:00"] },
      { id: "med-coversyl", name: "Coversyl", dose: "5 mg", note: "", times: ["08:00"] },
      { id: "med-tilanta", name: "Tilanta", dose: "90 mg", note: "", times: ["08:45", "20:30"] },
      { id: "med-beloc", name: "Beloc ZOK", dose: "50 mg", note: "", times: ["08:45"] },
      { id: "med-ator", name: "Ator", dose: "40 mg", note: "", times: ["20:30"] }
    ];
    var doctors = [
      { id: "doc-elif", name: "Dr. Elif Örnek", specialty: "Kardiyoloji", phone: "0212 000 00 01", note: "" },
      { id: "doc-can", name: "Dr. Can Deneme", specialty: "Aile hekimi", phone: "0212 000 00 02", note: "" }
    ];
    var health = {
      procedure: { date: procDate, hospital: "Örnek Hastanesi", doctor: "Dr. Elif Örnek", access: "Sağ el bileği", summary: "Koroner anjiyografi + stent (örnek kayıt)" },
      stents: [
        { id: "stent-1", vessel: "LAD", segment: "Proksimal", diameter: "3.0 mm", length: "18 mm", model: "ilaç kaplı", code: "ORNEK-01" },
        { id: "stent-2", vessel: "RCA", segment: "Orta", diameter: "3.5 mm", length: "24 mm", model: "ilaç kaplı", code: "ORNEK-02" }
      ],
      profile: { name: "Ahmet Demo", birthDate: "1968-04-12", bloodType: "A Rh+", allergies: "Bilinen yok", emergencyName: "Ayşe Demo", emergencyPhone: "0500 000 00 00", diagnoses: "Örnek kayıt", heart: "Örnek kayıt" },
      notes: [{ id: "note-1", title: "Diyet notu", text: "Tuz kısıtlaması, haftada 3 gün yürüyüş." }]
    };
    var appointments = [{ id: "appt-1", rc: 1, date: apptDate, time: "10:30", doctorId: "doc-elif", place: "Örnek Hastanesi", note: "" }];

    // Web state as N.backup({json: JSON.stringify(state)}) writes it: {days:{key:{s,a,m,u}}, v:1}
    var days = {}, doses = {}, crisis = [2, 5, 9, 13, 17, 21], i, k;
    for (i = 59; i >= 0; i--) {
      k = key(addDays(today, -i));
      var m = {};
      if (i > 0) { m = { "08:00": 1, "08:45": 1, "20:30": 1 }; if (i <= 14) doses[k] = copy(m); }
      days[k] = { s: i < 23 ? 1 : 0, a: i < 41 ? 1 : 0, m: m, u: crisis.indexOf(i) >= 0 ? 1 : 0 };
    }
    return { meds: meds, doctors: doctors, health: health, appointments: appointments,
      habitTimes: { h1: "07:15", h2: "12:30", h3: "16:30", h4: "19:00" }, bpTimes: ["08:30", "20:00"],
      docs: docList(procDate, Date.now()), doses: doses, backup: JSON.stringify({ days: days, v: 1 }) };
  }

  window.DEMO_DATA = { seed: seed, metrics: metrics, day: day, healthStatus: healthStatus, rng: rng };
})();
