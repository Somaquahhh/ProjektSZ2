/* menü json tömb.
--------------------------------------------------------------*/


// --- ROLE alapú menüszűrés ---
let USER_ROLE = "Students"; // alapértelmezett (ha nincs session)


const ROLE_LEVEL = {
  Students: 1,
  Teachers: 2,
  Boss: 3
};


async function loadUserRole() {
  try {
    const r = await fetch("/api/me", { credentials: "include" });
    if (!r.ok) return;
    const me = await r.json();
    USER_ROLE = (me.role || "Students").trim();
  } catch (e) {
    // marad Students
  }
}


function canSee(item) {
  const need = item.minRole || "Students";
  return (ROLE_LEVEL[USER_ROLE] || 0) >= (ROLE_LEVEL[need] || 999);
}


// --- menü: minRole mezőkkel ---
var menü_json = [{
  "text": "Vissza a kezdőoldalra ",
  "ikon": "",
  "url": "index.html",
  "tip": 3,
  minRole: "Students"
}, {
  "text": "Adatkereső",
  "ikon": "",
  "url": "a.html",
  "tip": 0,
  minRole: "Teachers"
}, {
  "text": "RFID be",
  "ikon": "",
  "url": "rfid.html",
  "tip": 0,
  minRole: "Teachers"
}, {
  "text": "RFID ki",
  "ikon": "",
  "url": "rfidki.html",
  "tip": 0,
  minRole: "Teachers"
}, {
  "text": "Kikérő kezelő",
  "ikon": "",
  "url": "b.html",
  "tip": 0,
  minRole: "Students"
}, {
  "text": "Késéses",
  "ikon": "",
  "url": "keseses.html",
  "tip": 0,
  minRole: "Teachers"
}, {
  "text": "Saját adatok",
  "ikon": "",
  "url": "sajat.html",
  "tip": 0,
  minRole: "Students"
},{
  "text": "Naplo",
  "ikon": "",
  "url": "naplozos.html",
  "tip": 0,
  minRole: "Boss"
}, {
  "text": "Admin panel",
  "ikon": "",
  "url": "admin.html",
  "tip": 0,
  minRole: "Boss"
}, {
  "text": "Csány Technikum weboldala",
  "ikon": "",
  "url": "https://www.csany-zeg.hu/",
  "tip": 2,
  minRole: "Students"
}];


/* menü_json ból menüpontokat generál id="menu1_ul" ba
--------------------------------------------------------------*/
function menu_generator() {
  let result = "";


  const visibleMenu = menü_json
    .map((item, idx) => ({ ...item, _idx: idx }))
    .filter(canSee);


  for (let k = 0; k < visibleMenu.length; k++) {
    const item = visibleMenu[k];
    result += `<li class="xmenu" id="menu1_${item._idx}">${item.text}</li>`;
  }


  return result;
}


/* ------- nem kell sql injection ! tessék szépen "kieszképelni" a user inputot! */
function strE(s) {
  return s
    .replaceAll("'", "")
    .replaceAll("\"", "")
    .replaceAll("\t", "")
    .replaceAll("\\", "")
    .replaceAll("`", "");
}


/* length kar. hosszú random stringet generál */
function makeid(length) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}


/* server: url címről <TAG> "hova" id-be kerül a html / json adat
-----------------------------------------------------------------*/
function ajax_get(urlsor, hova, tipus, aszinkron) {
  try {
    sessionStorage.setItem("last_ajax_page", String(urlsor || ""));
  } catch {}


  // ✅ script cache, hogy ugyanazt a külső scriptet ne töltsük be kétszer
  window.__S13_loadedSrc = window.__S13_loadedSrc || new Set();
  window.__S13_loadedInline = window.__S13_loadedInline || new Set();


  function shouldSkipSrc(src) {
    const s = String(src || "").toLowerCase();
    // ezeket NEM töltjük be újra (ezek már betöltve vannak az index.html-en)
    return (
      s.includes("common_studio13.js") ||
      s.includes("jquery") ||
      s.includes("bootstrap") ||
      s.includes("datatables") ||
      s.endsWith(".css")
    );
  }


  function hashInline(code) {
    // egyszerű hash elég: hossz + első/utolsó 30 char
    const c = String(code || "");
    return `${c.length}:${c.slice(0,30)}:${c.slice(-30)}`;
  }


  $.ajax({
    url: urlsor,
    type: "get",
    async: aszinkron,
    cache: false,
    dataType: tipus === 0 ? "html" : "json",
    beforeSend: function () { $("#loader1").css("display", "block"); },


    success: function (data) {
      if (tipus !== 0) {
        $(hova).html(data);
        return;
      }


      // ✅ 1) parseoljuk a teljes HTML-t, de megtartjuk a script tageket is, hogy mi döntsünk
      const nodes = $.parseHTML(String(data), document, true) || [];
      const $wrap = $("<div></div>").append(nodes);


      // ✅ 2) kivesszük a body tartalmat (ha full html jött)
      const $body = $wrap.find("body");
      const $contentRoot = $body.length ? $body : $wrap;


      // ✅ 3) összes script összegyűjtése (head+body)
      const $scripts = $wrap.find("script");


      // ✅ 4) a tartalomból kidobjuk a script tageket, hogy ne a jQuery futtassa automatikusan
      $contentRoot.find("script").remove();


      // ✅ 5) HTML berakása a #main1-be
      $(hova).empty().append($contentRoot.contents());


      // ✅ 6) Most MI futtatjuk a script-eket kontrolláltan:
      //    - src-es script: csak ha nem skip és még nem volt betöltve
      //    - inline script: egyszer fut (hash alapján)
      const loadPromises = [];


      $scripts.each(function () {
        const src = this.getAttribute("src");
        if (src) {
          if (shouldSkipSrc(src)) return;
          if (window.__S13_loadedSrc.has(src)) return;


          window.__S13_loadedSrc.add(src);


          // külső script betöltés
          const p = new Promise((resolve) => {
            const el = document.createElement("script");
            el.src = src;
            el.onload = resolve;
            el.onerror = resolve; // ne álljon meg hiba miatt
            document.body.appendChild(el);
          });
          loadPromises.push(p);
          return;
        }


        // inline script
       // inline script (MINDIG fusson, mert AJAX betöltésnél ez inicializálja az oldalt)
      const code = this.textContent || "";
      if (!code.trim()) return;
        $.globalEval(code);
      });


      // ha volt külső script, várjuk meg, utána frissítünk
      Promise.all(loadPromises).finally(() => {
        if (typeof buildQuickActions === "function") buildQuickActions();
      });
    },


    error: function (jqXHR) {
      mySend({ text: jqXHR.responseText, tip: "danger", mp: 5 });
    },


    complete: function () { $("#loader1").css("display", "none"); }
  });


  return true;
}


/* server: url címről "return s"-be kerül a html / json adat: Rest API
-------------------------------------------------------------------*/
function ajax_post(urlsor, tipus) {
  var s = "";
  $.ajax({
    url: urlsor,
    type: "post",
    async: false,
    cache: false,
    dataType: tipus === 0 ? 'html' : 'json',
    beforeSend: function () { $('#loader1').css("display", "block"); },
    success: function (data) { s = data; },
    error: function (jqXHR) { mySend({ text: jqXHR.responseText, tip: "danger", mp: 5 }); },
    complete: function () { $('#loader1').css("display", "none"); }
  });
  return s;
}


/* Toast üzenet */
function mySend(ops) {
  var defOps = { text: "", tip: "success", mp: 5 };
  ops = $.extend({}, defOps, ops);


  var id = "toast1";
  $("#" + id).remove();


  var s = `
  <div id="${id}" class="toast align-items-center text-bg-${ops.tip} border-0"
       style="position:fixed; right:10px; bottom:10px; z-index:99999"
       role="alert" aria-live="assertive" aria-atomic="true">
    <div class="d-flex">
      <div class="toast-body" style="font-size: 12pt; font-weight:bold;">${ops.text}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  </div>`;


  $("body").append(s);


  var el = document.getElementById(id);
  var toast = new bootstrap.Toast(el, {
    autohide: ops.mp !== 0,
    delay: ops.mp * 1000
  });
  toast.show();
}


/* kérdés ablak */
function myQuestion(ops) {
  var id = "myQuestion";
  var old = document.getElementById(id);
  if (old) old.remove();


  var s = `
  <div class="modal fade" id="${id}" tabindex="-1" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-secondary text-white">
          <h5 class="modal-title">Megerősítés</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">${ops.text}</div>
        <div class="modal-footer">
          <div class="button ok">OK</div>
          <div class="button cancel" data-bs-dismiss="modal">mégse</div>
        </div>
      </div>
    </div>
  </div>`;


  $("body").append(s);


  var el = document.getElementById(id);
  var modal = new bootstrap.Modal(el, { backdrop: "static", keyboard: true });
  modal.show();


  el.querySelector(".ok").addEventListener("click", function () {
    modal.hide();
  }, { once: true });
}


/* =========================================================
   ✅ ÚJ: szerepkör magyarul
   ========================================================= */
function roleHu(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r.includes("teacher")) return "Tanár";
  if (r.includes("student")) return "Diák";
  if (r.includes("boss") || r.includes("admin")) return "Admin";
  return role || "-";
}


/* =========================================================
   ✅ ÚJ: Gyors műveletek generálása menüből
   - csak ami látható az adott role-nak
   - csak belső oldalak (tip 0 vagy 3 és .html)
   - aktuális oldalt kihagyja
   ========================================================= */
function buildQuickActions() {
  const host = document.getElementById("sb_quick");
  if (!host) return;


  // ✅ ha indexen belül AJAX-olunk, akkor az “aktuális oldal” a last_ajax_page
  let current = "";
  try {
    current = (sessionStorage.getItem("last_ajax_page") || "").toLowerCase();
  } catch {}
  // ha nincs, akkor a normál path
  if (!current) current = (location.pathname.split("/").pop() || "").toLowerCase();


  const visible = menü_json
    .map((item, idx) => ({ ...item, _idx: idx }))
    .filter(canSee)
    .filter(it => (it.tip === 0 || it.tip === 3))
    .filter(it => String(it.url || "").toLowerCase().endsWith(".html"))
    .filter(it => String(it.url || "").toLowerCase() !== current);


  // ✅ NEM <a href> hanem gomb, és mi döntjük el: AJAX vagy navigáció
  host.innerHTML = visible.map(it => {
    return `<button type="button" class="side-btn" data-url="${it.url}" data-tip="${it.tip}">${it.text}</button>`;
  }).join("") || `<div class="muted small">Nincs elérhető gyors művelet.</div>`;


  // Klikk delegálás
  host.onclick = function (e) {
    const btn = e.target.closest("button[data-url]");
    if (!btn) return;


    const url = btn.dataset.url;
    const tip = Number(btn.dataset.tip || 0);


    const hasMain = document.querySelector("#main1");      // index layout
    const hasAjax = (typeof ajax_get === "function");


    // ✅ ha index/layout oldalról kattintasz → AJAX a #main1-be
    if (hasMain && hasAjax && (tip === 0)) {
      ajax_get(url, "#main1", 0, true);
      buildQuickActions(); // frissítjük, hogy az aktuális kimaradjon
      return;
    }


    // tip==3: teljes oldal navigáció (pl index.html)
    window.location.href = url;
  };
}


/* =========================================================
   ✅ ÚJ: Bejelentkezés óta eltelt idő (timer)
   - localStorage: login_ts
   - ha nincs, de be van jelentkezve -> mostantól számol
   - logout gomb lenyomásakor törli
   ========================================================= */
function formatDuration(ms) {
  ms = Math.max(0, ms);
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}


let _loginTimerInterval = null;


function startLoginTimer() {
  const el = document.getElementById("sb_session_age");
  if (!el) return;


  if (_loginTimerInterval) clearInterval(_loginTimerInterval);


  const tsRaw = localStorage.getItem("login_ts");
  const ts = tsRaw ? Number(tsRaw) : NaN;


  function tick() {
    const now = Date.now();
    const start = Number.isFinite(ts) ? ts : now;
    el.textContent = formatDuration(now - start);
  }


  tick();
  _loginTimerInterval = setInterval(tick, 1000);
}


function clearLoginTimer() {
  localStorage.removeItem("login_ts");
  if (_loginTimerInterval) clearInterval(_loginTimerInterval);
  _loginTimerInterval = null;


  const el = document.getElementById("sb_session_age");
  if (el) el.textContent = "-";
}


/* =========================================================
   ✅ ÚJ: Oldalsáv kitöltése /session alapján
   (ha nincs oldalsáv a page-en, csendben nem csinál semmit)
   ========================================================= */
async function fillSidebarsFromSession() {
  const elName = document.getElementById("sb_name");
  const elRole = document.getElementById("sb_role");
  const elEmail = document.getElementById("sb_email");
  const elOm = document.getElementById("sb_om");


  const elLogged = document.getElementById("sb_logged");
  const elAgeLabel = document.getElementById("sb_session_label"); // opcionális


  // ha egyik sincs, akkor nincs sidebar ezen az oldalon
  if (!elName && !elRole && !elLogged) return;


  try {
    const r = await fetch("/session", { cache: "no-store", credentials: "include" });
    const s = await r.json();


    const logged = !!s.bejelentkezett;
    const user = s.user || {};


    if (elLogged) elLogged.textContent = logged ? "Igen" : "Nem";


    if (logged) {
      if (elName) elName.textContent = user.NEV || "-";
      if (elRole) elRole.textContent = roleHu(user.CSOPORT || "-");
      if (elEmail) elEmail.textContent = user.EMAIL || "-";
      if (elOm) elOm.textContent = user.OM || "-";


      // login_ts beállítás, ha még nincs
      if (!localStorage.getItem("login_ts")) {
        localStorage.setItem("login_ts", String(Date.now()));
      }


      // Session labelből csinálunk "Bejelentkezve óta"-t
      if (elAgeLabel) elAgeLabel.textContent = "Bejelentkezve óta";


      startLoginTimer();


      // gyorsgombok újrarajzolása role szerint
      buildQuickActions();
    } else {
      clearLoginTimer();
    }
  } catch (e) {
    // ne omoljon ossze a UI
  }
}


/* =========================================================
   ✅ ÚJ: Logout gomb esetén login_ts törlése
   (index.html-ben van #logout_direct_button)
   ========================================================= */
function bindLogoutClear() {
  const btn = document.getElementById("logout_direct_button");
  if (!btn) return;
  btn.addEventListener("click", function () {
    // már kattintáskor töröljük, a szerveres logout úgyis megy a te kódoddal
    clearLoginTimer();
  }, { capture: true });
}


function applyThemeFromStorage() {
  const t = localStorage.getItem("theme") || "dark";
  document.body.classList.toggle("theme-light", t === "light");
}


function ensureThemeToggleButton() {
  // ha már van, ne duplázzuk
  if (document.getElementById("theme_toggle")) return;


  const btn = document.createElement("button");
  btn.id = "theme_toggle";
  btn.type = "button";
  btn.className = "theme-toggle-btn";
  btn.title = "Téma váltás";


  function renderIcon() {
    const isLight = document.body.classList.contains("theme-light");
    btn.textContent = isLight ? "🌙" : "☀️";
  }


  btn.onclick = () => {
    const isLight = document.body.classList.toggle("theme-light");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    renderIcon();
  };


  document.body.appendChild(btn);
  applyThemeFromStorage();
  renderIcon();
}




/* =========================================================
   automatikus menü init (ha van #menu1_ul)
   + sidebars init
   ========================================================= */
(async function initEverything() {
  try {
    await loadUserRole();


    if (typeof $ !== "undefined" && $("#menu1_ul").length) {
      $("#menu1_ul").html(menu_generator());
    }


    ensureThemeToggleButton();
    applyThemeFromStorage();


    // sidebarok, ha vannak
    bindLogoutClear();
    fillSidebarsFromSession();


    // ha ajax tartalmat cserélsz, a sidebar attól még marad.
    // viszont a quick actions néha jó, ha újra renderel:
    setTimeout(() => {
      buildQuickActions();
    }, 250);


  } catch (e) {
    // no-op
  }
})();


/* =========================================================
   ✅ OLDALFÜGGŐ SÚGÓ – AJAX + normál oldal BIZTOS
   - AJAX eset: window.__S13_CURRENT_PAGE alapján
   - Normál oldal: location.pathname alapján
   ========================================================= */
   (function () {
    const HELP_BY_PAGE = {
      "index.html": "Kezdőoldal\n– Fő menü és gyors műveletek",
      "sajat.html": "Saját adatok\n– Saját felhasználói adatok / saját listák",
      "a.html": "Adatkereső\n– Tanári jogosultság szükséges",
      "b.html": "Kikérő\n– Diák: beküldés\n– Tanár: elbírálás",
      "rfid.html": "RFID be\n– Kártya leolvasás = érkezés",
      "rfidki.html": "RFID ki\n– Kártya leolvasás = távozás",
      "keseses.html": "Késések\n– Tanári nézet",
      "admin.html": "Admin panel\n– Felhasználók kezelése (Boss)",
      "naplozos.html": "Admin napló\n– RFID + kikérő események (Boss)",
      "login.html": "Bejelentkezés\n– Email/Név + jelszó",
    };
  
  
    function fileName(x) {
      return (String(x || "")
        .split("?")[0]
        .split("#")[0]
        .split("/")
        .pop() || "").toLowerCase();
    }
  
  
    function getCurrentPage() {
      // ✅ 1) AJAX: amit utoljára ajax_get betöltött
      const ajaxFile = fileName(window.__S13_CURRENT_PAGE);
      if (ajaxFile && ajaxFile.endsWith(".html")) return ajaxFile;
  
  
      // ✅ 2) Normál oldal
      const p = (location.pathname || "").toLowerCase();
      if (p === "/index" || p.endsWith("/index")) return "index.html";
      const real = fileName(p);
      return real || "index.html";
    }
  
  
    function showHelp() {
      const page = getCurrentPage();
      const txt = HELP_BY_PAGE[page] || ("Ehhez az oldalhoz nincs súgó: " + page);
      alert("SÚGÓ\n\n" + txt);
    }
  
  
    function initBtn() {
      if (document.getElementById("help_btn")) return;
  
  
      const btn = document.createElement("button");
      btn.id = "help_btn";
      btn.type = "button";
      btn.textContent = "❓ Súgó";
      btn.style.cssText =
        "position:fixed;bottom:12px;right:12px;z-index:99999;padding:6px 10px;font-size:14px;cursor:pointer;";
  
  
      btn.onclick = showHelp;
      document.body.appendChild(btn);
    }
  
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initBtn);
    } else {
      initBtn();
    }
  })();
  
  
  
  
