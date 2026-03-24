

const mysql = require("mysql");
const util = require("util");

const DEBUG_SQL = process.env.DEBUG_SQL === "1";

const pool = mysql.createPool({
  connectionLimit: 10,
  host: "10.2.0.11",
  user: "gaal.oliver",
  port: "3306",
  password: "Csany0379",
  database: "studio13_csany_zeg",

});


function logToDb(p0, p1, sql, jsText) {
  try {
    const sql_naplo = "INSERT INTO naplo (USER, URL, SQLX) VALUES (?, ?, ?)";
    const sqlx = String(sql) + (jsText ? ` TEXT:${jsText}` : "");
    pool.query(sql_naplo, [String(p0 || ""), String(p1 || ""), sqlx], () => {});
  } catch {
    // log hiba nem kritikus
  }
}

const DB = {
  query(sql, params, callback) {
    // params sok helyen üres tömb → biztos fallback
    const p = Array.isArray(params) ? params : [];
    const p0 = p.length > 0 && p[0] != null ? String(p[0]) : "";
    const p1 = p.length > 1 && p[1] != null ? String(p[1]) : "";

    pool.getConnection((connErr, connection) => {
      if (connErr) {
        const js = { text: String(connErr.message || connErr), tip: "error" };
        return callback(null, JSON.stringify(js));
      }

      const done = (okStr, errStr, jsTextForLog = "") => {
        // biztosan csak egyszer engedjük el
        try { connection.release(); } catch {}
        // konzol + DB napló
        if (DEBUG_SQL) {
          console.log(util.inspect(`SQL: ${sql} --- ${p0} ${p1}`, false, null, false));
          if (jsTextForLog) console.log(util.inspect(jsTextForLog, false, null, false));
        }
        logToDb(p0, p1, sql, jsTextForLog);
        // vissza a hívónak
        callback(okStr, errStr);
      };

      connection.query(sql, p, (err, rows) => {
        if (err) {
          const js = { text: `[${err.errno}] --> ${err.sqlMessage}`, tip: "error" };
          return done(null, JSON.stringify(js), js.text);
        }

        // SELECT vs nem SELECT
        const firstWord = String(sql || "").trim().split(/\s+/)[0]?.toUpperCase() || "";
        if (firstWord === "SELECT") {
          const out = {
            text: 0,
            tip: rows && rows.length ? "info" : "warning",
            count: rows ? rows.length : 0,
            rows: rows || [],
          };
          return done(JSON.stringify(out), null, `SELECT count=${out.count}`);
        }

        // INSERT/UPDATE/DELETE/DDL
        const templ = { INSERT: "Bevitel", UPDATE: "Módosítás", DELETE: "Törlés" };
        const op = templ[firstWord] || firstWord || "SQL";
        const affected = Number(rows?.affectedRows || 0);

        const out = Object.assign({}, rows, {
          count: affected,
          tip: affected === 0 ? "warning" : "info",
          text: `${op}: ${affected} rekord.`,
        });

        return done(JSON.stringify(out), null, out.text);
      });
    });
  },
};

module.exports = DB;
