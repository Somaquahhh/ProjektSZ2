const express = require("express");
const session = require("express-session");
const path = require("path");


const app = express();
const port = 3000;


app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const DB = require("./datamodule_mysql.js");


/* -------------------- SESSION -------------------- */
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


/* -------------------- ROLE / JOGOSULTSÁG -------------------- */


function normalizeRole(role) {
  role = (role || "").trim();
  if (role.endsWith(";")) role = role.slice(0, -1).trim(); // pl "Teachers;"
  if (role === "Bosses") role = "Boss";
  return role;
}


function getRole(req) {
  return normalizeRole(req.session?.CSOPORT);
}


const ROLE_LEVEL = { Students: 1, Teachers: 2, Boss: 3 };


// minimum szerepkör bizonyos oldalakhoz
const PAGE_MIN_ROLE = {
  "/index.html": "Students",
  "/sajat.html": "Students",
  "/b.html": "Students",


  "/a.html": "Teachers",
  "/rfid.html": "Teachers",
  "/rfidki.html": "Teachers",
  "/keseses.html": "Teachers",
  "/admin.html":"Bosses"
};


// JAVÍTÁS: ha nincs a listában, akkor csak bejelentkezést kérünk, NEM tiltunk
function canAccessPage(role, reqPath) {
  const need = PAGE_MIN_ROLE[reqPath];
  if (!need) return true; // <-- EZ a fő javítás
  return (ROLE_LEVEL[role] || 0) >= ROLE_LEVEL[need];
}


function guardHtmlByRole(req, res, next) {
  if (!req.path.endsWith(".html")) return next();
  if (req.path === "/login.html") return next();


  if (!req.session || !req.session.ID_USER) {
    return res.redirect("/login.html");
  }


  const role = getRole(req);
  if (role === "Boss") return next();


  if (!canAccessPage(role, req.path)) {
    return res.status(403).send("Nincs jogosultságod ehhez az oldalhoz!");
  }


  next();
}


/* -------------------- AUTH MIDDLEWARE -------------------- */


function authMiddleware(req, res, next) {
  if (req.session && req.session.ID_USER) return next();


  // API hívás → JSON
  if (req.path.startsWith("/api")) {
    return res.status(401).json({ error: "Nincs bejelentkezve" });
  }


  // HTML → login
  return res.redirect("/login.html");
}


/* -------------------- STATIKUS / PUBLIKUS -------------------- */


// publikus statikusok
app.use("/image", express.static(path.join(__dirname, "public/image")));
app.use("/style.css", express.static(path.join(__dirname, "public/style.css")));
app.use(
  "/common_studio13.js",
  express.static(path.join(__dirname, "public/common_studio13.js"))
);


// cache tiltás
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});


const PUBLIC_HTML = ["/login.html"];


// minden HTML-hez kell login (kivéve login.html)
app.use((req, res, next) => {
  if (req.path.endsWith(".html") && !PUBLIC_HTML.includes(req.path)) {
    return authMiddleware(req, res, next);
  }
  next();
});


// role guard + public mappa (login.html, css/js stb)
app.use(guardHtmlByRole);
app.use(express.static(path.join(__dirname, "public")));


/* -------------------- LOGIN / SESSION / ROOT -------------------- */


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
      req.session.ID_USER = data.rows[0].ID_USER;
      req.session.NEV = data.rows[0].NEV;
      req.session.EMAIL = data.rows[0].EMAIL;
      req.session.CSOPORT = normalizeRole(data.rows[0].CSOPORT);
      req.session.OM = data.rows[0].OM;
      req.session.MOST = Date.now();
    }


    res.json(data);
  });
});


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


app.get("/", (req, res) => {
  if (req.session && req.session.ID_USER) return res.redirect("/index");
  return res.redirect("/login.html");
});


app.get("/index", authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.get("/api/me", (req, res) => {
  if (!req.session?.ID_USER) return res.status(401).json({ error: "not logged in" });
  res.json({
    id: req.session.ID_USER,
    role: normalizeRole(req.session.CSOPORT),
  });
});


app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json("Hiba a kijelentkezés során.");
    res.json("Sikeres kijelentkezés.");
  });
});


/* -------------------- API ENDPOINTOK (VEGYES) -------------------- */


// példa users lista
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


// tanárok listája
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
      res.json(JSON.parse(json_data)); // {count, rows}
    } catch {
      res.status(500).json({ error: "Hibás JSON válasz" });
    }
  });
});


/* -------------------- KIKÉRŐ -------------------- */


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


  // csak létező tanárnak lehessen
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


    const sqlIns = `
      INSERT INTO kikero (ID_KERO, ID_TANAR, OK, RESZLETEK, NAP)
      VALUES (?, ?, ?, ?, ?)
    `;


    DB.query(sqlIns, [idKero, idTanar, ok, reszletek || null, nap], (json_ins, err2) => {
      if (err2) return res.status(500).json({ error: "DB hiba (mentés)" });
      res.json({ ok: true });
    });
  });
});


// KIKÉRŐK tanárnak (csak neki)
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


// KIKÉRŐ státusz (tanár)
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


    // ha 0 sor frissült → már elbírálták / nem az övé
    try {
      const data = JSON.parse(json_data);
      if (!data || data.count === 0) {
        return res.status(409).json({ error: "Ez a kikérő már el van bírálva (vagy nem a tied)." });
      }
    } catch {
      // ha a DB modul nem count-ot ad, akkor is oké
    }


    res.json({ ok: true });
  });
});


// KIKÉRŐK diák saját
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


/* -------------------- RFID -------------------- */


// RFID lookup
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


// RFID event (kibe mentés + késés számítás)
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


  function parseHHMM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;
    const hh = Number(m[1]),
      mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hh, mm };
  }


  const st = parseHHMM(start);
  const en = parseHHMM(end);
  if (!st || !en) return res.status(400).json({ error: "start/end formátum HH:MM legyen" });


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


    const shiftStart = new Date(now);
    shiftStart.setHours(st.hh, st.mm, 0, 0);


    const shiftEnd = new Date(now);
    shiftEnd.setHours(en.hh, en.mm, 0, 0);


    const graceMs = graceHours * 60 * 60 * 1000;


    let status = "ok";
    let diffMs = 0;


    if (direction === "in") {
      diffMs = Math.max(0, now - shiftStart);
      status = diffMs > graceMs ? "late" : "ok";
    } else {
      diffMs = Math.max(0, shiftEnd - now);
      status = diffMs > graceMs ? "early_leave" : "ok";
    }


    const diffMinutes = Math.round(diffMs / 60000);
    const kesesPerc = direction === "in" ? diffMinutes : 0;


    const sqlInsert = `
      INSERT INTO kibe (ID_USER, DIRECTION, RFID_POZ, KESES_PERC)
      VALUES (?, ?, ?, ?)
    `;


    DB.query(sqlInsert, [user.ID_USER, direction, kod, kesesPerc], (json2, error2) => {
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
    });
  });
});


/* -------------------- KIBE / KÉSÉSEK -------------------- */


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
    if (error) return res.status(500).json({ error: "DB hiba", details: String(error) });


    try {
      const data = JSON.parse(json_data);
      res.json(data.rows || []);
    } catch {
      res.status(500).json({ error: "JSON hiba" });
    }
  });
});


// ha ezt eddig auth nélkül használtad, tartsd úgy; én biztonságosra tettem (authMiddleware)
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
      res.send(json_data); // STRING, ahogy eddig is működött
    }
  );
});


// ================= ADMIN CRUD (NYITOTT - NINCS requireBoss) =================


// LISTA
app.get("/api/admin/users", (req, res) => {
  DB.query(
    "SELECT ID_USER, NEV, EMAIL, CSOPORT FROM users ORDER BY ID_USER DESC",
    [], // nem kell ide session/originalUrl
    (ok, err) => {
      if (err) return res.status(500).send(err);
      const js = JSON.parse(ok);
      res.json({ rows: js.rows || [] });
    }
  );
});


// ADD
app.post("/api/admin/users", (req, res) => {
  const { nev, email, csoport, jelszo } = req.body || {};
  if (!nev || !email || !csoport || !jelszo) {
    return res.status(400).send("Hiányzó adat");
  }


  // FIGYELEM: ha nálad nem JELSZO mező van, hanem PASSWORD, akkor ezt át kell írni!
  DB.query(
    "INSERT INTO users (NEV, EMAIL, CSOPORT, JELSZO) VALUES (?,?,?,?)",
    [nev, email, csoport, jelszo], // csak 4 param, mert 4 db ? van
    (ok, err) => {
      if (err) return res.status(500).send(err);
      res.json({ ok: true });
    }
  );
});


// UPDATE
app.put("/api/admin/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const { nev, email, csoport } = req.body || {};
  if (!id || !nev || !email || !csoport) {
    return res.status(400).send("Hiányzó adat");
  }


  DB.query(
    "UPDATE users SET NEV=?, EMAIL=?, CSOPORT=? WHERE ID_USER=?",
    [nev, email, csoport, id],
    (ok, err) => {
      if (err) return res.status(500).send(err);
      res.json({ ok: true });
    }
  );
});


// DELETE
app.delete("/api/admin/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).send("Rossz ID");


  DB.query(
    "DELETE FROM users WHERE ID_USER=?",
    [id],
    (ok, err) => {
      if (err) return res.status(500).send(err);
      res.json({ ok: true });
    }
  );
});




/* -------------------- START -------------------- */
app.listen(port, () => {
  console.log(`std13 app listening at http://localhost:${port}`);
});



