STUDIO13 – Readme.txt SZ2 Projekt
================================================

0) Mi ez a projekt?
-------------------
Diák ki- és beléptetõ, kikérõ kezelõ valamint késés nyilvántartó rendszer, RFID azonosítással.

- Backend (Node.js + Express):   std13.js  (ez a szerver belépési pontja)
- Frontend (statikus fájlok):   a /public mappában lévõ HTML/CSS/JS
- Nyitó oldal (frontend):       login.html (bejelentkezés)
  Sikeres login után:           /index  -> public/index.html

Fontos:
- A szerver a /public könyvtárat szolgálja ki statikusan.
- A HTML oldalak védettek, kivétel: /login.html.(publikus)


1) Kicsomagolás / mappaszerkezet
--------------------------------
1. Hozz létre egy mappát, pl.:
   C:\projektek\studio13\
2. Ide csomagold ki a projektet úgy, hogy ez a szerkezet meglegyen:

   studio13/
        image/
     std13.js
     datamodule_mysql.js
     package.json
     package-lock.json
     public/
       index.html
       login.html
       common_studio13.js
       style.css
       ... (többi html, képek)

Megjegyzés: ha a HTML fájlok nem a public mappában vannak, a szerver nem fogja õket kiszolgálni.


2) Szükséges szoftverek
-----------------------
- Node.js (ajánlott: 18+)
- npm (Node.js-el együtt jön)

(MySQL-rõl:


3) Függõségek telepítése
------------------------
Nyiss terminált a projekt gyökerében (ahol a package.json van), majd:
    (cntrl "ö")
  npm install

A package.json alapján a szükséges csomagok:
- express
- express-session
- mysql


4) Indítás (backend)
--------------------
A backend fájl neve: std13.js
Indítás parancs (a projekt gyökerében):

  node std13.js

Alap port: 9021
Böngészõben:
- http://sexard3-214.tolna.net:9021  -> automatikusan /login.html (többi olal nem elérhetõ amíg nincs session)


5) Frontend nyitó oldal
-----------------------
- A nyitó oldal a public/login.html
- A szerver a /... útvonalon:
  - ha be vagy jelentkezve: /index
  - ha nem: /login.html


6) Bejelentkezés / szerepkörök
------------------------------
- Login endpoint: POST /login
  - body: { "user": "email VAGY név", "psw": "jelszó" }
- Session ellenõrzés: GET /session
- Kijelentkezés: POST /logout

Szerepkörök (CSOPORT mezõ alapján):
- Students 
- Teachers 
- Boss

 Jogosultási hierachia szintek alapján:
 Students > Teachers > Boss

Oldaljogosultság:
- Students: index.html, sajat.html, b.html
- Teachers: a.html, rfid.html, rfidki.html, keseses.html, index.html, b.html, sajat.html
- Boss: Az összes oldalhoz van hozzáférése


7) Admin felhasználó / jelszó
-----------------------------
Az alap admin felhasználó:
Felhasználónév: The Boss
Jelszó: pite

A login a "users" táblából dolgozik, és a jelszót MD5-tel ellenõrzi:
- WHERE PASSWORD = MD5(?).

Mit jelent ez a gyakorlatban?
- Kell, hogy legyen a DB-ben legalább 1 felhasználó a users táblában.
- Ha kell Boss (admin) fiók, akkor a users.CSOPORT = 'Boss'.



8) MySQL (most nem kötelezõ, de késõbb kellhet)
----------------------------------------------
Ha a projekthez tartozik SQL dump fájl:
1. Nyisd meg MySQL-ben (pl. phpMyAdmin vagy MySQL Workbench).
2. Importáld a dump fájlt az elõbb létrehozott adatbázisba.
A rendszer az alábbi fõbb táblákat használja (a backend és HTML oldalak alapján):
* users
* kibe
* kikero
* audit log (ha engedélyezett)
* egyéb admin napló táblák




