// Demo UI: menu, simulated notifications, home screen widgets, report page, tel: guard, intro note.
(function () {
  "use strict";
  var D = window.RitimDemo;
  var INTRO_KEY = "ritim-demo-intro";
  var CALL_NOTE = "Demoda arama yapılmaz.";
  var FRAME = window.matchMedia ? window.matchMedia("(min-width:600px) and (hover:hover)") : { matches: false };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, text, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function button(cls, text, onClick) {
    var b = el("button", cls, text, { type: "button" });
    b.addEventListener("click", onClick);
    return b;
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function today() { return D.dateKey(Date.now()); }
  function openTab(tab) { D.emit("openTab", { tab: tab }); }

  // ---- demo layers (home screen, report) own one history entry each, so back / swipe-back closes only them ----
  var layerEntries = 0, selfBack = 0;
  function pushLayer() { try { history.pushState({ rdLayer: 1 }, ""); layerEntries++; } catch (e) { /* no history */ } }
  function popLayer(fromHistory) {
    if (!layerEntries) return;
    layerEntries--;
    if (!fromHistory) { selfBack++; try { history.back(); } catch (e) { selfBack--; } }
  }
  D.onPopState = function (e) {
    if (selfBack) { selfBack--; return true; }
    if (report) { closeReport(true); return true; }
    if (home) { closeHome(true); return true; }
    if (e && e.state && e.state.rdLayer) return true; // stale forward entry, no demo layer: ignore
    return false;
  };
  function focusFirst(root) {
    var f = root.querySelector('button:not([hidden]), [tabindex="0"]');
    if (f) f.focus();
  }
  function restoreFocus(elm) {
    var shown = function (x) { return x && x !== document.body && x.isConnected && x.getClientRects().length > 0; };
    var t = shown(elm) ? elm : shown(menuBtn) ? menuBtn : null;
    if (t) t.focus();
  }

  // ---- toast ----
  var toastEl = el("div", "rd-toast", null, { role: "status", "aria-live": "polite" }), toastT = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("rd-show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("rd-show"); }, 3000);
  }

  // ---- notification ----
  var notif = null, notifT = 0, lastSlot = null, testT = 0, testAcked = false;
  function closeNotif() {
    clearTimeout(notifT);
    if (!notif) return;
    var n = notif; notif = null;
    if (reduced) { n.remove(); return; }
    n.classList.remove("rd-in");
    setTimeout(function () { n.remove(); }, 250);
  }
  function taken(spec) {
    if (spec.kind === "test-med") {
      testAcked = true; clearTimeout(testT);
      D.store().testAckAt = Date.now(); D.save();
      D.emit("doseChanged", { date: today(), slot: "test", taken: true });
    } else {
      D.setDose(today(), spec.slot, true);
    }
    closeNotif();
    renderHome();
  }
  function notify(spec) {
    if (!spec) return;
    closeNotif();
    if (spec.kind === "med") lastSlot = spec.slot;
    if (spec.kind === "test-med" && !spec.repeat) {
      testAcked = false; clearTimeout(testT);
      testT = setTimeout(function () { if (!testAcked) notify(D.testFollowUp()); }, 120000);
    }
    var n = el("div", "rd-notif", null, { role: "alert" });
    var main = el("div", "rd-n-main", null, { role: "button", tabindex: "0", "aria-label": "Uygulamayı aç" });
    var head = el("div", "rd-n-head");
    head.appendChild(el("span", "rd-n-icon", null, { "aria-hidden": "true" }));
    head.appendChild(el("span", "rd-n-app", "Ritim · şimdi"));
    main.appendChild(head);
    main.appendChild(el("div", "rd-n-title", spec.title));
    if (spec.body) main.appendChild(el("div", "rd-n-body", spec.body));
    function open() { closeNotif(); closeHome(); openTab("bugun"); }
    main.addEventListener("click", open);
    main.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    n.appendChild(main);
    if (spec.kind === "med" || spec.kind === "followup" || spec.kind === "test-med") {
      var acts = el("div", "rd-n-acts");
      acts.appendChild(button("rd-n-act", "Aldım", function () { taken(spec); }));
      acts.appendChild(button("rd-n-act", "Kapat", closeNotif));
      n.appendChild(acts);
    }
    var y0 = null;
    n.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    n.addEventListener("touchend", function (e) {
      if (y0 !== null && e.changedTouches[0].clientY - y0 < -30) closeNotif();
      y0 = null;
    });
    document.body.appendChild(n);
    notif = n;
    void n.offsetHeight; // start the slide-in from the off-screen position
    n.classList.add("rd-in");
    notifT = setTimeout(closeNotif, 8000);
  }

  // ---- home screen ----
  var home = null, homeT = 0, homeKey = "", homeReturn = null;
  function closeHome(fromHistory) {
    if (!home) return;
    clearInterval(homeT); home.remove(); home = null;
    menuBtn.hidden = false;
    popLayer(fromHistory);
    restoreFocus(homeReturn); homeReturn = null;
  }
  function openHome() {
    closeMenu();
    if (home) return renderHome();
    homeReturn = document.activeElement;
    home = el("div", "rd-home", null, { role: "dialog", "aria-modal": "true", "aria-label": "Ana ekran" });
    document.body.appendChild(home);
    menuBtn.hidden = true;
    pushLayer();
    homeKey = "";
    renderHome();
    focusFirst(home);
    homeT = setInterval(renderHome, 20000);
  }
  // Rebuilds only when the shown content changed; keeps keyboard focus on the same control (data-rd-key).
  function renderHome() {
    if (!home) return;
    var v = D.homeView(Date.now()), m = v.med, s = v.sum;
    if (v.key === homeKey) return;
    homeKey = v.key;
    var act = document.activeElement, fk = act && home.contains(act) ? act.getAttribute("data-rd-key") : null;
    home.textContent = "";
    var top = el("div", "rd-h-top");
    top.appendChild(el("div", "rd-h-clock", v.clock));
    top.appendChild(el("div", "rd-h-date", v.date));
    home.appendChild(top);
    var grid = el("div", "rd-h-grid");
    var med = el("div", "rd-w rd-w-med", null, { role: "button", tabindex: "0", "data-rd-key": "med", "aria-label": "Ritim · İlaç: " + m.k + " " + m.time });
    med.appendChild(el("div", "rd-w-k", m.k));
    med.appendChild(el("div", "rd-w-time", m.time));
    med.appendChild(el("div", "rd-w-names", m.names));
    if (m.canTake) {
      var take = button("rd-w-take", "Aldım", function (e) {
        e.stopPropagation();
        D.setDose(m.date, m.slot, true);
        renderHome();
      });
      take.setAttribute("data-rd-key", "take");
      med.appendChild(take);
    }
    var sum = el("div", "rd-w rd-w-sum", null, { role: "button", tabindex: "0", "data-rd-key": "sum", "aria-label": "Ritim · Özet" });
    sum.appendChild(el("div", "rd-w-k", "Bugün"));
    sum.appendChild(el("div", "rd-chip rd-chip-bp", s.bp));
    sum.appendChild(el("div", "rd-chip rd-chip-step", s.steps));
    sum.appendChild(el("div", "rd-chip rd-chip-quit", s.quit));
    [[med, "bugun"], [sum, "olcum"]].forEach(function (p) {
      function go() { closeHome(); openTab(p[1]); }
      p[0].addEventListener("click", go);
      p[0].addEventListener("keydown", function (e) { if (e.target === p[0] && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } });
      var cell = el("div", "rd-h-cell");
      cell.appendChild(p[0]);
      cell.appendChild(el("div", "rd-w-label", p[1] === "bugun" ? "Ritim · İlaç" : "Ritim · Özet"));
      grid.appendChild(cell);
    });
    home.appendChild(grid);
    var back = button("rd-h-back", "Uygulamaya dön", function () { closeHome(); });
    back.setAttribute("data-rd-key", "back");
    home.appendChild(back);
    if (fk) { var f = home.querySelector('[data-rd-key="' + fk + '"]') || home.querySelector('[data-rd-key="med"]'); if (f) f.focus(); }
  }

  // ---- report page (BpReport.kt layout) ----
  var report = null, oldTitle = "", reportReturn = null;
  function dmy(t) { var d = new Date(t); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear(); }
  function closeReport(fromHistory) {
    if (!report) return;
    report.remove(); report = null; menuBtn.hidden = false;
    popLayer(fromHistory);
    restoreFocus(reportReturn); reportReturn = null;
  }
  function openReport(data) {
    closeMenu();
    // A second report replaces the first in place (same history entry, same return focus).
    if (report) report.remove(); else { reportReturn = document.activeElement; pushLayer(); }
    var s = data.summary || {};
    report = el("div", "rd-report", null, { role: "dialog", "aria-modal": "true", "aria-label": "Tansiyon raporu" });
    var bar = el("div", "rd-r-bar");
    bar.appendChild(el("span", "rd-r-file", data.title || ""));
    bar.appendChild(button("rd-r-btn", "Yazdır / PDF", function () {
      oldTitle = document.title;
      document.title = String(data.title || "Tansiyon").replace(/\.pdf$/, "");
      window.print();
    }));
    bar.appendChild(button("rd-r-btn", "Kapat", function () { closeReport(); }));
    report.appendChild(bar);
    var page = el("div", "rd-r-page");
    page.appendChild(el("h1", "rd-r-h", "Tansiyon ölçümleri"));
    if (data.name) page.appendChild(el("div", "rd-r-name", data.name));
    page.appendChild(el("div", "rd-r-period", data.period || ""));
    page.appendChild(el("div", "rd-r-sum", s.count + " ölçüm · ortalama " + s.sysAvg + "/" + s.diaAvg + " mmHg" + (s.pulseAvg != null ? " · nabız " + s.pulseAvg : "")));
    page.appendChild(el("div", "rd-r-range", "En düşük–en yüksek: büyük " + s.sysMin + "–" + s.sysMax + ", küçük " + s.diaMin + "–" + s.diaMax + " mmHg"));
    var table = el("table", "rd-r-table"), tr = el("tr");
    ["Tarih", "Saat", "Büyük (mmHg)", "Küçük (mmHg)", "Nabız"].forEach(function (h) { tr.appendChild(el("th", null, h, { scope: "col" })); });
    table.appendChild(el("thead")).appendChild(tr);
    var tb = table.appendChild(el("tbody"));
    (data.rows || []).forEach(function (r) {
      var row = el("tr");
      [dmy(r.time), hhmm(r.time), r.sys, r.dia, r.pulse == null ? "–" : r.pulse].forEach(function (c) { row.appendChild(el("td", null, String(c))); });
      tb.appendChild(row);
    });
    page.appendChild(table);
    page.appendChild(el("div", "rd-r-foot", "Kaynak: " + (data.source || "") + " → Health Connect · Ritim · oluşturma " + dmy(Date.now()) + " " + hhmm(Date.now())));
    report.appendChild(page);
    document.body.appendChild(report);
    menuBtn.hidden = true;
    focusFirst(report);
  }
  window.addEventListener("afterprint", function () { if (oldTitle) { document.title = oldTitle; oldTitle = ""; } });

  // ---- intro note ----
  function showIntro() {
    closeMenu();
    var ov = el("div", "rd-intro", null, { role: "dialog", "aria-modal": "true", "aria-labelledby": "rd-intro-h" });
    var card = el("div", "rd-intro-card");
    card.appendChild(el("h2", null, "Ritim — tanıtım sürümü", { id: "rd-intro-h" }));
    card.appendChild(el("p", null, "Bu sayfadaki bütün bilgiler uydurmadır. Bildirimleri ve ana ekran widget'larını sağ üstteki Demo menüsünden deneyebilirsiniz. Gerçek uygulama Android telefonda çalışır; bu sürümde gerçek bildirim, alarm ve sağlık verisi yoktur."));
    var go = button("rd-intro-go", "Başla", function () {
      try { localStorage.setItem(INTRO_KEY, "1"); } catch (e) { /* session only */ }
      ov.remove();
    });
    card.appendChild(go);
    ov.appendChild(card);
    document.body.appendChild(ov);
    go.focus();
  }

  // ---- menu ----
  var menuBtn = button("rd-btn", "Demo", function (e) { e.stopPropagation(); if (menu.hidden) openMenu(); else closeMenu(); });
  menuBtn.setAttribute("aria-haspopup", "menu");
  menuBtn.setAttribute("aria-expanded", "false");
  var menu = el("div", "rd-menu", null, { role: "menu", "aria-label": "Demo" });
  menu.hidden = true;
  function fire(kind) {
    var r = D.notification(kind, Date.now(), lastSlot);
    if (r && r.toast) toast(r.toast); else notify(r);
  }
  function resetDemo() {
    try {
      ["ritim-demo-v1", "ritim-demo-intro", "ritim"].forEach(function (k) { localStorage.removeItem(k); }); // intro note too: it shows again
    } catch (e) { /* storage blocked: demo.js keeps memory state */ }
    D.reset();
    location.reload();
  }
  [["İlaç bildirimi", function () { fire("med"); }],
    ["90 dk tekrarı", function () { fire("followup"); }],
    ["Alışkanlık", function () { fire("habit"); }],
    ["Tansiyon ölçümü", function () { fire("bp"); }],
    ["Randevu hatırlatması", function () { fire("appt"); }, true],
    ["Ana ekran", openHome, true],
    ["Demoyu sıfırla", resetDemo],
    ["Bu bir tanıtım sürümü", showIntro]].forEach(function (it) {
    var b = button("rd-mi" + (it[2] ? " rd-mi-sep" : ""), it[0], function () { closeMenu(); it[1](); });
    b.setAttribute("role", "menuitem");
    menu.appendChild(b);
  });
  function openMenu() { menu.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); }
  function closeMenu() { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) closeMenu(); });
  // Capture phase: a demo layer takes Escape before the app's own handler closes the sheet underneath.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!menu.hidden) { closeMenu(); menuBtn.focus(); }
    else if (notif) closeNotif();
    else if (report) closeReport();
    else if (home) closeHome();
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  // ---- tel: guard (doctor "Ara", emergency contact, 112 note) ----
  // click, middle click (auxclick) and the context menu ("copy/open link") all stay in the demo.
  ["click", "auxclick", "contextmenu"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var a = e.target.closest && e.target.closest('a[href^="tel:"]');
      if (a) { e.preventDefault(); e.stopPropagation(); toast(CALL_NOTE); }
    }, true);
  });
  var winOpen = window.open;
  window.open = function (url) {
    if (/^\s*tel:/i.test(String(url))) { toast(CALL_NOTE); return null; }
    return winOpen.apply(window, arguments);
  };

  // ---- desktop frame: the body is the scroller there, so window.scrollTo goes to it ----
  var winScroll = window.scrollTo;
  window.scrollTo = function (x, y) {
    if (!FRAME.matches) return winScroll.apply(window, arguments);
    if (typeof x === "object") document.body.scrollTo(x); else document.body.scrollTo(x || 0, y || 0);
  };
  var aside = el("aside", "rd-aside");
  aside.appendChild(el("h2", null, "Ritim"));
  aside.appendChild(el("p", null, "Kalp stenti sonrası ilaç, sigara/alkol ve tansiyon takibi için Android uygulamasının tanıtım sürümü. Bütün veriler uydurmadır."));
  aside.appendChild(el("p", null, "Bildirimleri ve ana ekran widget'larını Demo menüsünden deneyin."));

  // Bezel: masks the frame corners above every app layer.
  document.body.appendChild(aside);
  document.body.appendChild(menuBtn);
  document.body.appendChild(menu);
  document.body.appendChild(toastEl);
  document.body.appendChild(el("div", "rd-bezel", null, { "aria-hidden": "true" }));
  window.Capacitor.Plugins.Ritim.addListener("doseChanged", function () { renderHome(); });

  D.toast = toast; D.notify = notify; D.openReport = openReport; D.openHome = openHome;

  var seen = false;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch (e) { seen = false; }
  if (!seen) showIntro();
})();
