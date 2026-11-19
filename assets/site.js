/* Basil's Kitchen: search/filters on the home page, print + keep-screen-on on recipe pages.
   No cookies, no analytics, no third-party code. The keep-screen-on choice lives in
   localStorage on this device only. */
(function () {
  "use strict";

  /* ---------- Home: search + filters ---------- */
  var list = document.getElementById("recipe-list");
  if (list) {
    var cards = Array.prototype.slice.call(list.querySelectorAll(".card-item"));
    var q = document.getElementById("q");
    var countEl = document.getElementById("count");
    var emptyEl = document.getElementById("empty-search");
    var state = { course: "", era: "", weeknight: false, facet: "" };

    function norm(s) {
      return (s || "")
        .toLowerCase()
        .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    }

    function apply() {
      var terms = norm(q && q.value || "").split(/\s+/).filter(Boolean);
      var shown = 0;
      cards.forEach(function (li) {
        var hay = norm(li.getAttribute("data-search"));
        var ok = terms.every(function (t) { return hay.indexOf(t) !== -1; });
        if (ok && state.course) ok = (li.getAttribute("data-course") || "").split("|").indexOf(state.course) !== -1;
        if (ok && state.era) ok = li.getAttribute("data-era") === state.era;
        if (ok && state.weeknight) ok = li.getAttribute("data-weeknight") === "yes";
        if (ok && state.facet) ok = (li.getAttribute("data-facet") || "").split("|").indexOf(state.facet) !== -1;
        li.hidden = !ok;
        if (ok) shown++;
      });
      if (countEl) countEl.textContent = shown === 1 ? "1 recipe" : shown + " recipes";
      if (emptyEl) emptyEl.hidden = shown !== 0;
      list.hidden = shown === 0;
    }

    document.querySelectorAll(".chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.getAttribute("data-group");
        var val = btn.getAttribute("data-value");
        if (group === "weeknight") {
          state.weeknight = !state.weeknight;
          btn.setAttribute("aria-pressed", String(state.weeknight));
        } else {
          state[group] = val;
          document.querySelectorAll('.chip[data-group="' + group + '"]').forEach(function (b) {
            b.setAttribute("aria-pressed", String(b === btn));
          });
        }
        apply();
      });
    });
    if (q) q.addEventListener("input", apply);
    var params = new URLSearchParams(location.search);
    if (q && params.get("q")) q.value = params.get("q");
    function press(group, val) {
      var btn = document.querySelector('.chip[data-group="' + group + '"][data-value="' + val + '"]');
      if (!btn) return;
      if (group === "weeknight") {
        state.weeknight = val === "yes";
        btn.setAttribute("aria-pressed", String(state.weeknight));
      } else {
        state[group] = val;
        document.querySelectorAll('.chip[data-group="' + group + '"]').forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
      }
    }
    if (params.get("course")) press("course", params.get("course").toLowerCase());
    if (params.get("era")) press("era", params.get("era").toLowerCase());
    if (params.get("weeknight") === "yes" || params.get("weeknight") === "true") press("weeknight", "yes");
    if (params.get("facet")) press("facet", params.get("facet").toLowerCase());
    apply();
  }

  /* ---------- Recipe: print ---------- */
  var printBtn = document.getElementById("print-btn");
  if (printBtn) printBtn.addEventListener("click", function () { window.print(); });

  /* ---------- Recipe: tap-to-check is pure HTML/CSS (checkboxes). Reset button: ---------- */
  var resetBtn = document.getElementById("reset-btn");
  if (resetBtn) resetBtn.addEventListener("click", function () {
    document.querySelectorAll(".checklist input[type=checkbox]").forEach(function (c) { c.checked = false; });
  });

  /* ---------- Recipe: keep screen on (Screen Wake Lock API) ---------- */
  var wakeBtn = document.getElementById("wake-btn");
  if (wakeBtn) {
    var KEY = "bk-keep-screen-on";
    var note = document.getElementById("wake-note");
    var lock = null;
    var wanted = false;

    function store(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }
    function stored() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
    function show(on) {
      wakeBtn.setAttribute("aria-pressed", String(on));
      wakeBtn.querySelector(".label").textContent = on ? "Screen stays on" : "Keep screen on";
    }

    if (!("wakeLock" in navigator)) {
      wakeBtn.disabled = true;
      show(false);
      if (note) { note.hidden = false; note.textContent = "Keep-screen-on isn't available in this browser. You can lengthen your phone's screen timeout in its settings instead."; }
    } else {
      var request = function () {
        return navigator.wakeLock.request("screen").then(function (l) {
          lock = l; show(true);
          l.addEventListener("release", function () { lock = null; if (!wanted) show(false); });
        }).catch(function () {
          show(false);
          if (note) { note.hidden = false; note.textContent = "Couldn't keep the screen on (battery saver may block it). Tap again to retry."; }
        });
      };
      wakeBtn.addEventListener("click", function () {
        wanted = !wanted; store(wanted);
        if (wanted) { request(); }
        else { if (lock) lock.release(); lock = null; show(false); }
      });
      document.addEventListener("visibilitychange", function () {
        if (wanted && !lock && document.visibilityState === "visible") request();
      });
      if (stored()) { wanted = true; show(true); request(); }
    }
  }
})();

(function () {
  var menu = document.querySelector(".nav-menu");
  var box = document.getElementById("nav-toggle");
  if (!menu || !box) return;
  document.addEventListener("click", function (ev) {
    if (box.checked && !menu.contains(ev.target)) box.checked = false;
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && box.checked) box.checked = false;
  });
})();
