// =========================================================
// 0) ALAPOK: importok, app init, body parser, DB
// =========================================================
const express = require("express");
const session = require("express-session");
const path = require("path");

const DB = require("./datamodule_mysql.js");

const DEBUG_STD13 =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_STD13 === "1";

const app = express();
const port = 3000;

app.set("trust proxy", true);

// JSON + form body-k fogadása
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================
// 1) SESSION: bejelentkezés állapotának tárolása sütiben
// =========================================================
app.use(
  session({
    key: "user_sid",
    secret: "nagyontitkossütemény",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 60 * 60 * 1000, // 1 óra
      httpOnly: true,
    },
  })
);

// =========================================================
// 2) SZEREPKÖR / JOGOSULTSÁG: role normalizálás + oldalak védése
// =========================================================

// Role-ok egységesítése (Bosses -> Boss, "Teachers;" -> "Teachers", stb.)
function normalizeRole(role) {
  role = (role || "").trim();
  if (role.endsWith(";")) role = role.slice(0, -1).trim();
  if (role === "Bosses") role = "Boss";
  return role;
}

// Aktuális user szerepe a session-ből
function getRole(req) {
  return normalizeRole(req.session?.CSOPORT);
}

// Role “szintek” (könnyebb összehasonlításhoz)
const ROLE_LEVEL = {
  Students: 1,
  Teachers: 2,
  Boss: 3,
};

// Minimum role egyes HTML oldalakhoz
// (ha nincs benne a map-ben, akkor nem tiltjuk)
const PAGE_MIN_ROLE = {
  "/index.html": "Students",
  "/sajat.html": "Students",
  "/b.html": "Students",

  "/a.html": "Teachers",
  "/rfid.html": "Teachers",
  "/rfidki.html": "Teachers",
  "/keseses.html": "Teachers",

  "/admin.html": "Boss",
};

// Megnézi, hogy a role elég-e az adott oldalhoz
function canAccessPage(role, reqPath) {
  const need = normalizeRole(PAGE_MIN_ROLE[reqPath]);
  if (!need) return true;

  role = normalizeRole(role);
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[need] || 0);
}

// HTML oldalak védése role alapján
// - login.html kivétel
// - ha nem html, átengedjük
function guardHtmlByRole(req, res, next) {
  if (!req.path.endsWith(".html")) return next();
  if (req.path === "/login.html") return next();

  // ha nincs login -> login oldal
  if (!req.session || !req.session.ID_USER) {
    return res.redirect("/login.html");
  }

  // ha van login, de kevés a jogosultság -> 403
  const role = getRole(req);
  if (!canAccessPage(role, req.path)) {
    return res.status(403).send("Nincs jogosultságod ehhez az oldalhoz!");
  }

  next();
}

// =========================================================
// 3) AUTH / ADMIN middleware-k (API vs HTML viselkedés)
// =========================================================

// Bejelentkezés kell:
// - /api/* -> 401 JSON
// - HTML -> login redirect
function authMiddleware(req, res, next) {
  if (req.session && req.session.ID_USER) return next();

  if (req.path.startsWith("/api")) {
    return res.status(401).json({ error: "Nincs bejelentkezve" });
  }

  return res.redirect("/login.html");
}

// Admin (Boss) jogosultság kell
function requireBoss(req, res, next) {
  const role = getRole(req);
  if (role === "Boss") return next();
  return res.status(403).json({ error: "Admin jogosultság szükséges" });
}

// =========================================================
// 4) AUDIT LOG: műveletek naplózása naplo_audit táblába
// =========================================================
function auditLog(
  req,
  { muvelet, objektum, objektumId = null, reszletek = null }
) {
  try {
    const actorId = req.session?.ID_USER ?? null;
    const actorNev = req.session?.NEV ?? null;

    // IP kinyerés (proxy mögött is)
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      null;

    let ipFinal = ip ? String(ip).replace(/^::ffff:/, "") : null;
    if (ipFinal === "::1") ipFinal = "127.0.0.1";

    DB.query(
      `INSERT INTO naplo_audit
       (FELHASZNALO_ID, FELHASZNALO_NEV, MUVELET, OBJEKTUM, OBJEKTUM_ID, RESZLETEK, IP_CIM)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actorId,
        actorNev,
        String(muvelet || "").slice(0, 50),
        String(objektum || "").slice(0, 50),
        objektumId,
        reszletek ? String(reszletek) : null,
        ipFinal ? String(ipFinal).slice(0, 64) : null,
      ],
      () => {}
    );
  } catch (e) {
    console.error("AUDIT LOG ERROR:", e);
  }
}

// =========================================================
// 5) STATIKUSOK + CACHE tiltás + HTML beléptetés/role guard
// =========================================================

// Publikus statikus fájlok külön route-okon
app.use("/image", express.static(path.join(__dirname, "public/image")));
app.use("/style.css", express.static(path.join(__dirname, "public/style.css")));
app.use(
  "/common_studio13.js",
  express.static(path.join(__dirname, "public/common_studio13.js"))
);

// Cache tiltás (hogy mindig friss legyen a HTML/JS/CSS)
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Publikusan elérhető HTML oldalak (nem kell login)
const PUBLIC_HTML = ["/login.html"];

// Minden HTML-hez kell login (kivéve login.html)
// (API-kat külön az authMiddleware védi endpointonként / globálisan is lehetne)
app.use((req, res, next) => {
  if (req.path.endsWith(".html") && !PUBLIC_HTML.includes(req.path)) {
    return authMiddleware(req, res, next);
  }
  next();
});

// Role alapú HTML védelem + public mappa kiszolgálása
app.use(guardHtmlByRole);
app.use(express.static(path.join(__dirname, "public")));

// =========================================================
// 6) LOGIN / SESSION / ROOT (belépés, kijelentkezés, alap route-ok)
// =========================================================

// LOGIN (email vagy név + jelszó)
app.post("/login", (req, res) => {
  const user = (req.body.user || "").trim();
  const psw = (req.body.psw || "").trim();

  if (!user || !psw) {
    return res.status(400).json({ count: 0, error: "Hiányzó adatok" });
  }

  const sql = `
    SELECT ID_USER, NEV, CSOPORT, EMAIL, OM
    FROM users
    WHERE (EMAIL = ? OR NEV = ?)
      AND PASSWORD = MD5(?)
    LIMIT 1
  `;

  DB.query(sql, [user, user, psw], (json_data, error) => {
    if (error) {
      console.error("LOGIN DB HIBA:", error);
      return res.status(500).json({ count: 0, error: "DB hiba" });
    }

    const data = JSON.parse(json_data);

    if (data.count === 1) {
      // SESSION beállítás
      req.session.ID_USER = data.rows[0].ID_USER;
      req.session.NEV = data.rows[0].NEV;
      req.session.EMAIL = data.rows[0].EMAIL;
      req.session.CSOPORT = normalizeRole(data.rows[0].CSOPORT);
      req.session.OM = data.rows[0].OM;
      req.session.MOST = Date.now();

      // AUDIT: belépés
      auditLog(req, {
        muvelet: "BELEPES",
        objektum: "auth",
        objektumId: req.session.ID_USER,
        reszletek: "Sikeres bejelentkezés",
      });
    }

    res.json(data);
  });
});

// SESSION INFO (front-endnek: belépett-e, ki az)
app.get("/session", (req, res) => {
  const s = req.session;

  if (s && s.ID_USER) {
    res.json({
      bejelentkezett: true,
      user: {
        ID_USER: s.ID_USER,
        NEV: s.NEV,
        EMAIL: s.EMAIL,
        CSOPORT: s.CSOPORT || "n/a",
        OM: s.OM,
      },
    });
  } else {
    res.json({ bejelentkezett: false });
  }
});

// ROOT: ha belépve -> /index, ha nem -> login
app.get("/", (req, res) => {
  if (req.session && req.session.ID_USER) return res.redirect("/index");
  return res.redirect("/login.html");
});

// INDEX: példa külön route-ra
app.get("/index", authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API: aktuális user szerep (gyors check UI-nak)
app.get("/api/me", (req, res) => {
  if (!req.session?.ID_USER)
    return res.status(401).json({ error: "not logged in" });

  res.json({
    id: req.session.ID_USER,
    role: normalizeRole(req.session.CSOPORT),
  });
});

// LOGOUT
app.post("/logout", (req, res) => {
  // AUDIT: kijelentkezés
  auditLog(req, {
    muvelet: "KIJELENTKEZES",
    objektum: "auth",
    objektumId: req.session?.ID_USER,
    reszletek: "Kijelentkezés",
  });

  req.session.destroy((err) => {
    if (err) return res.status(500).json("Hiba a kijelentkezés során.");
    res.json("Sikeres kijelentkezés.");
  });
});

// =========================================================
// 7) “VEGYES” API-k (általános listák / teszt jellegű route-ok)
// =========================================================

// példa: users lista (neve alapján "asd" -> érdemes lenne átnevezni)
app.post("/asd", authMiddleware, (req, res) => {
  const sql = `
    SELECT OM, NEV, EMAIL, CSOPORT
    FROM users
  `;

  DB.query(sql, [], (json_data, error) => {
    if (error) return res.status(500).json({ error: "Adatbázis hiba" });
    try {
      res.json(JSON.parse(json_data));
    } catch {
      res.status(500).json({ error: "Hibás JSON válasz" });
    }
  });
});

// tanárok listája (kikérőhöz)
app.get("/api/tanarok", authMiddleware, (req, res) => {
  const sql = `
    SELECT ID_USER AS id, NEV AS nev
    FROM users
    WHERE CSOPORT = 'Teachers'
    ORDER BY NEV
  `;

  DB.query(sql, [], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });
    try {
      res.json(JSON.parse(json_data));
    } catch {
      res.status(500).json({ error: "Hibás JSON válasz" });
    }
  });
});

// =========================================================
// 8) KIKÉRŐ API (diák kér -> tanár elbírál -> diák visszanéz)
// =========================================================

// KIKÉRŐ létrehozás (diák)
app.post("/api/kikero", authMiddleware, (req, res) => {
  const { idTanar, ok, nap, reszletek, kuldoNev } = req.body || {};

  if (!idTanar || !ok || !nap || !kuldoNev) {
    return res.status(400).json({
      error: "Hiányzó adatok",
      received: { idTanar, ok, nap, kuldoNev },
    });
  }

  const idKero = req.session.ID_USER;

  // Biztonsági check: valóban tanár-e a kiválasztott ID
  const sqlCheck = `
    SELECT ID_USER
    FROM users
    WHERE ID_USER = ? AND CSOPORT = 'Teachers'
    LIMIT 1
  `;

  DB.query(sqlCheck, [idTanar], (json_check, err) => {
    if (err) return res.status(500).json({ error: "DB hiba (ellenőrzés)" });

    const chk = JSON.parse(json_check);
    if (!chk.rows || chk.rows.length === 0) {
      return res.status(400).json({ error: "A kiválasztott tanár nem érvényes." });
    }

    // Beszúrás
    const sqlIns = `
      INSERT INTO kikero (ID_KERO, ID_TANAR, OK, RESZLETEK, NAP)
      VALUES (?, ?, ?, ?, ?)
    `;

    DB.query(
      sqlIns,
      [idKero, idTanar, ok, reszletek || null, nap],
      (json_ins, err2) => {
        if (err2) return res.status(500).json({ error: "DB hiba (mentés)" });
        res.json({ ok: true });
      }
    );
  });
});

// KIKÉRŐK tanárnak (csak a sajátjai)
app.get("/api/kikero/tanar", authMiddleware, (req, res) => {
  const idTanar = req.session.ID_USER;

  const sql = `
    SELECT
      k.ID_KIKERO,
      k.ID_KERO,
      u.NEV AS KULDO_NEV,
      k.OK,
      k.RESZLETEK,
      k.NAP,
      k.LETREHOZVA,
      k.ALLAPOT
    FROM kikero k
    JOIN users u ON u.ID_USER = k.ID_KERO
    WHERE k.ID_TANAR = ?
    ORDER BY k.LETREHOZVA DESC
    LIMIT 200
  `;

  DB.query(sql, [idTanar], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });
    try {
      res.json(JSON.parse(json_data));
    } catch {
      res.status(500).json({ error: "Hibás JSON válasz" });
    }
  });
});

// KIKÉRŐ státusz (tanár dönt: elfogad / elutasít)
app.post("/api/kikero/allapot", authMiddleware, (req, res) => {
  const idTanar = req.session.ID_USER;
  const { idKikero, allapot, megjegyzes } = req.body || {};

  const allowed = ["ELFOGADVA", "ELUTASITVA"];
  if (!idKikero || !allowed.includes(allapot)) {
    return res.status(400).json({ error: "Hibás adatok" });
  }

  const sql = `
    UPDATE kikero
    SET ALLAPOT = ?, DONTES_IDO = NOW(), DONTES_MEGJEGYZES = ?
    WHERE ID_KIKERO = ? AND ID_TANAR = ? AND ALLAPOT = 'UJ'
    LIMIT 1
  `;

  DB.query(sql, [allapot, megjegyzes || null, idKikero, idTanar], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });

    try {
      const data = JSON.parse(json_data);
      if (!data || data.count === 0) {
        return res.status(409).json({
          error: "Ez a kikérő már el van bírálva (vagy nem a tied).",
        });
      }
    } catch {}

    res.json({ ok: true });
  });
});

// KIKÉRŐK diák saját listája
app.get("/api/kikero/diak", authMiddleware, (req, res) => {
  const idKero = req.session.ID_USER;

  const sql = `
    SELECT
      k.ID_KIKERO,
      k.ID_TANAR,
      t.NEV AS TANAR_NEV,
      k.OK,
      k.RESZLETEK,
      k.NAP,
      k.LETREHOZVA,
      k.ALLAPOT,
      k.DONTES_IDO,
      k.DONTES_MEGJEGYZES
    FROM kikero k
    JOIN users t ON t.ID_USER = k.ID_TANAR
    WHERE k.ID_KERO = ?
    ORDER BY k.LETREHOZVA DESC
    LIMIT 200
  `;

  DB.query(sql, [idKero], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });
    try {
      res.json(JSON.parse(json_data));
    } catch {
      res.json({ rows: [] });
    }
  });
});

// =========================================================
// 9) RFID API (keresés + esemény mentés kibe táblába)
// =========================================================

// RFID -> user lookup
app.get("/api/rfid", authMiddleware, (req, res) => {
  const kod = (req.query.kod || "").trim();
  if (!kod) return res.status(400).json({ error: "Hiányzó kod paraméter" });

  const sql = `
    SELECT ID_USER, NEV, EMAIL, OM
    FROM users
    WHERE RFID = ?
    LIMIT 1
  `;

  DB.query(sql, [kod], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });

    const data = JSON.parse(json_data);
    if (!data.rows || data.rows.length === 0) {
      return res.status(404).json({ error: "Nincs ilyen RFID" });
    }

    res.json(data.rows[0]);
  });
});

// RFID event: belépés/kilépés mentése + késés/korai távozás számítás
app.get("/api/rfid/event", authMiddleware, (req, res) => {
  const kod = (req.query.kod || "").trim();
  const direction = (req.query.direction || "").trim(); // in | out
  const graceHours = Number(req.query.graceHours ?? 0);
  const start = (req.query.start || "08:00").trim();
  const end = (req.query.end || "16:00").trim();

  if (!kod) return res.status(400).json({ error: "Hiányzó kod paraméter" });
  if (direction !== "in" && direction !== "out") {
    return res.status(400).json({ error: "direction csak in vagy out lehet" });
  }
  if (Number.isNaN(graceHours) || graceHours < 0) {
    return res.status(400).json({ error: "graceHours nem jó szám" });
  }

  // "HH:MM" -> {hh, mm}
  function parseHHMM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);

    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hh, mm };
  }

  const st = parseHHMM(start);
  const en = parseHHMM(end);
  if (!st || !en)
    return res.status(400).json({ error: "start/end formátum HH:MM legyen" });

  // User lekérés RFID alapján
  const sqlUser = `
    SELECT ID_USER, NEV, EMAIL, OM
    FROM users
    WHERE RFID = ?
    LIMIT 1
  `;

  DB.query(sqlUser, [kod], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba (users)" });

    const data = JSON.parse(json_data);
    if (!data.rows || data.rows.length === 0) {
      return res.status(404).json({ error: "Nincs ilyen RFID" });
    }

    const user = data.rows[0];
    const now = new Date();

    // Műszak kezdete / vége a mai napra
    const shiftStart = new Date(now);
    shiftStart.setHours(st.hh, st.mm, 0, 0);

    const shiftEnd = new Date(now);
    shiftEnd.setHours(en.hh, en.mm, 0, 0);

    const graceMs = graceHours * 60 * 60 * 1000;

    // status: ok | late | early_leave
    let status = "ok";
    let diffMs = 0;

    if (direction === "in") {
      // késés: most - kezdés (csak ha pozitív)
      diffMs = Math.max(0, now - shiftStart);
      status = diffMs > graceMs ? "late" : "ok";
    } else {
      // korai távozás: vég - most (csak ha pozitív)
      diffMs = Math.max(0, shiftEnd - now);
      status = diffMs > graceMs ? "early_leave" : "ok";
    }

    const diffMinutes = Math.round(diffMs / 60000);
    const kesesPerc = direction === "in" ? diffMinutes : 0;

    // Mentés kibe táblába
    const sqlInsert = `
      INSERT INTO kibe (ID_USER, DIRECTION, RFID_POZ, KESES_PERC)
      VALUES (?, ?, ?, ?)
    `;

    DB.query(
      sqlInsert,
      [user.ID_USER, direction, kod, kesesPerc],
      (json2, error2) => {
        if (error2) return res.status(500).json({ error: "DB hiba (kibe)" });

        res.json({
          ...user,
          saved: true,
          direction,
          graceHours,
          shift: { start, end },
          status,
          diffMinutes,
          kesesPerc,
        });
      }
    );
  });
});

// =========================================================
// 10) KIBE / KÉSÉSEK API (saját / összes / egyszerű lista)
// =========================================================

// Saját kibe lista
app.get("/api/my/kibe", authMiddleware, (req, res) => {
  const userId = req.session.ID_USER;

  const sql = `
    SELECT ID_KIBE, DIRECTION, RFID_POZ, DATUMIDO
    FROM kibe
    WHERE ID_USER = ?
    ORDER BY DATUMIDO DESC
  `;

  DB.query(sql, [userId], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });

    try {
      const data = JSON.parse(json_data);
      res.json(data.rows || []);
    } catch {
      res.status(500).json({ error: "Hibás JSON" });
    }
  });
});

// Összes késés (ahol KESES_PERC > 0)
app.get("/api/minden_keses", authMiddleware, (req, res) => {
  const sql = `
    SELECT
      u.NEV,
      u.OM,
      k.DATUMIDO,
      k.KESES_PERC
    FROM kibe k
    LEFT JOIN users u ON u.ID_USER = k.ID_USER
    WHERE k.KESES_PERC > 0
    ORDER BY k.DATUMIDO DESC
  `;

  DB.query(sql, [], (json_data, error) => {
    if (error)
      return res.status(500).json({ error: "DB hiba", details: String(error) });

    try {
      const data = JSON.parse(json_data);
      res.json(data.rows || []);
    } catch {
      res.status(500).json({ error: "JSON hiba" });
    }
  });
});

// Egyszerű kibe lista (STRING-ben visszaadva a DB választ)
app.post("/api/kibe_simple", authMiddleware, (req, res) => {
  DB.query(
    `
    SELECT
      k.ID_KIBE,
      u.NEV,
      k.DATUMIDO,
      k.DIRECTION,
      k.RFID_POZ,
      k.KESES_PERC
    FROM kibe k
    LEFT JOIN users u ON u.ID_USER = k.ID_USER
    ORDER BY k.DATUMIDO DESC
    LIMIT 1000
    `,
    [],
    (json_data, error) => {
      if (error) return res.status(500).send(error);
      res.send(json_data);
    }
  );
});

// =========================================================
// 11) ADMIN API (Boss): audit / kibe / kikero / users CRUD
// =========================================================

// AUDIT lista (Boss)
app.get("/api/admin/audit", authMiddleware, requireBoss, (req, res) => {
  const limit = Math.min(1000, Math.max(10, Number(req.query.limit || 200)));
  const q = (req.query.q || "").trim();

  let sql = `
    SELECT ID_NAPLO, DATUM_IDO, FELHASZNALO_ID, FELHASZNALO_NEV,
       MUVELET, OBJEKTUM, OBJEKTUM_ID, RESZLETEK, IP_CIM
      FROM naplo_audit
  `;
  const params = [];

  if (q) {
    sql += `
      WHERE FELHASZNALO_NEV LIKE ? OR MUVELET LIKE ? OR OBJEKTUM LIKE ? OR RESZLETEK LIKE ?
    `;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  sql += ` ORDER BY ID_NAPLO DESC LIMIT ${limit}`;

  DB.query(sql, params, (json_data, error) => {
    if (error) return res.status(500).send(error);
    try {
      const data = JSON.parse(json_data);
      res.json({ rows: data.rows || [] });
    } catch {
      res.json({ rows: [] });
    }
  });
});

// KIBE lista (Boss)
app.get("/api/admin/kibe", authMiddleware, requireBoss, (req, res) => {
  const sql = `
    SELECT
      k.ID_KIBE,
      u.NEV,
      k.DATUMIDO,
      k.DIRECTION,
      k.RFID_POZ,
      k.KESES_PERC
    FROM kibe k
    LEFT JOIN users u ON u.ID_USER = k.ID_USER
    ORDER BY k.DATUMIDO DESC
    LIMIT 1000
  `;

  DB.query(sql, [], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });
    try {
      const data = JSON.parse(json_data);
      res.json({ rows: data.rows || [] });
    } catch {
      res.status(500).json({ error: "JSON hiba" });
    }
  });
});

// KIBE törlés (Boss)
app.delete("/api/admin/kibe/:id", authMiddleware, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Rossz ID" });

  DB.query("DELETE FROM kibe WHERE ID_KIBE = ?", [id], (ok, err) => {
    if (err) return res.status(500).json({ error: "DB hiba" });

    auditLog(req, {
      muvelet: "TORLES",
      objektum: "kibe",
      objektumId: id,
      reszletek: "KIBE törölve",
    });

    res.json({ ok: true });
  });
});

// KIKERO lista (Boss)
app.get("/api/admin/kikero", authMiddleware, requireBoss, (req, res) => {
  const sql = `
    SELECT
      k.ID_KIKERO,
      u.NEV AS DIAK_NEV,
      t.NEV AS TANAR_NEV,
      k.NAP,
      k.OK,
      k.ALLAPOT
    FROM kikero k
    JOIN users u ON u.ID_USER = k.ID_KERO
    JOIN users t ON t.ID_USER = k.ID_TANAR
    ORDER BY k.LETREHOZVA DESC
    LIMIT 1000
  `;

  DB.query(sql, [], (json_data, error) => {
    if (error) return res.status(500).json({ error: "DB hiba" });
    try {
      const data = JSON.parse(json_data);
      res.json({ rows: data.rows || [] });
    } catch {
      res.status(500).json({ error: "JSON hiba" });
    }
  });
});

// KIKERO törlés (Boss)
app.delete("/api/admin/kikero/:id", authMiddleware, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Rossz ID" });

  DB.query("DELETE FROM kikero WHERE ID_KIKERO = ?", [id], (ok, err) => {
    if (err) return res.status(500).json({ error: "DB hiba" });

    auditLog(req, {
      muvelet: "TORLES",
      objektum: "kikero",
      objektumId: id,
      reszletek: "KIKÉRŐ törölve",
    });

    res.json({ ok: true });
  });
});

// USERS create (Boss)
app.post("/api/admin/users", authMiddleware, requireBoss, (req, res) => {
  const { login, email, nev, om, rfid, password, csoport } = req.body || {};

  if (!login || !email || !nev || !om || !rfid || !password || !csoport) {
    return res.status(400).send("Hiányzó adat");
  }

  const allowed = ["Students", "Teachers", "Boss"];
  if (!allowed.includes(csoport)) {
    return res.status(400).send("Hibás csoport");
  }

  // Új ID_USER: MAX + 1
  DB.query("SELECT MAX(ID_USER) AS mx FROM users", [], (jsonMax, errMax) => {
    if (errMax) return res.status(500).send("DB hiba (MAX ID)");

    let mx = 0;
    try {
      const d = JSON.parse(jsonMax);
      mx = Number(d?.rows?.[0]?.mx ?? 0) || 0;
    } catch {
      mx = 0;
    }

    const newId = mx + 1;

    const sqlIns = `
      INSERT INTO users (ID_USER, LOGIN, EMAIL, NEV, OM, RFID, PASSWORD, CSOPORT, DATUMIDO)
      VALUES (?, ?, ?, ?, ?, ?, MD5(?), ?, NOW())
    `;

    DB.query(
      sqlIns,
      [newId, login, email, nev, om, rfid, password, csoport],
      (jsonIns, errIns) => {
        if (errIns) {
          return res.status(500).send("DB hiba (INSERT): " + String(errIns));
        }

        auditLog(req, {
          muvelet: "LETREHOZAS",
          objektum: "users",
          objektumId: newId,
          reszletek: JSON.stringify({ login, email, nev, om, rfid, csoport }),
        });

        res.json({ ok: true, id: newId });
      }
    );
  });
});

// USERS lista (Boss)
app.get("/api/admin/users", authMiddleware, requireBoss, (req, res) => {
  DB.query(
    "SELECT ID_USER, NEV, EMAIL, CSOPORT, OM, RFID FROM users ORDER BY ID_USER DESC",
    [],
    (ok, err) => {
      if (err) return res.status(500).send(err);
      const js = JSON.parse(ok);
      res.json({ rows: js.rows || [] });
    }
  );
});

// USERS update (Boss) - NEV/EMAIL/CSOPORT/OM/RFID + opcionális PASSWORD
app.put("/api/admin/users/:id", authMiddleware, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  let { nev, email, csoport, om, rfid, password } = req.body || {};

  nev = (nev || "").trim();
  email = (email || "").trim();
  csoport = (csoport || "").trim();
  om = (om ?? "").toString().trim();
  rfid = (rfid ?? "").toString().trim();
  password = (password ?? "").toString().trim();

  if (!id || !nev || !email || !csoport || !om || !rfid) {
    return res.status(400).send("Hiányzó adat");
  }

  const allowed = ["Students", "Teachers", "Boss"];
  if (!allowed.includes(csoport)) return res.status(400).send("Hibás csoport");

  if (!/^\d{11}$/.test(om)) {
    return res.status(400).send("Az OM pontosan 11 számjegy lehet!");
  }

  if (!rfid) return res.status(400).send("RFID kötelező");

  // Ha jelszó is jött, akkor azt is frissítjük
  if (password) {
    DB.query(
      "UPDATE users SET NEV=?, EMAIL=?, CSOPORT=?, OM=?, RFID=?, PASSWORD=MD5(?) WHERE ID_USER=?",
      [nev, email, csoport, om, rfid, password, id],
      (ok, err) => {
        if (err) return res.status(500).send(err);

        auditLog(req, {
          muvelet: "MODOSITAS",
          objektum: "users",
          objektumId: id,
          reszletek: JSON.stringify({
            nev,
            email,
            csoport,
            om,
            rfid,
            jelszoValtozott: true,
          }),
        });

        res.json({ ok: true, passwordChanged: true });
      }
    );
  } else {
    DB.query(
      "UPDATE users SET NEV=?, EMAIL=?, CSOPORT=?, OM=?, RFID=? WHERE ID_USER=?",
      [nev, email, csoport, om, rfid, id],
      (ok, err) => {
        if (err) return res.status(500).send(err);

        auditLog(req, {
          muvelet: "MODOSITAS",
          objektum: "users",
          objektumId: id,
          reszletek: JSON.stringify({
            nev,
            email,
            csoport,
            om,
            rfid,
            jelszoValtozott: false,
          }),
        });

        res.json({ ok: true, passwordChanged: false });
      }
    );
  }
});

// USERS delete (Boss)
app.delete("/api/admin/users/:id", authMiddleware, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Rossz ID" });

  DB.query("DELETE FROM users WHERE ID_USER=?", [id], (ok, err) => {
    if (err) return res.status(500).send(err);

    auditLog(req, {
      muvelet: "TORLES",
      objektum: "users",
      objektumId: id,
      reszletek: "User törölve",
    });

    res.json({ ok: true });
  });
});

// =========================================================
// 12) START
// =========================================================
app.listen(port, () => {
  if (DEBUG_STD13) console.log(`std13 app listening at http://localhost:${port}`);
});