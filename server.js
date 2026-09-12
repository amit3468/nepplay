"use strict";

/*
============================================================
                    NEPPLAY SERVER
============================================================
Run:  node server.js
Site: http://localhost:3000

STEP 10 + 11:
- Battle Royale match type
- Top 3 winners per BR match
- Join tracking (member marks "I'm in room")
============================================================
*/

var http = require("http");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var URL = require("url").URL;

var PORT = process.env.PORT || 3000;
var HOST = "0.0.0.0";
var BASE_DIR = __dirname;

var USERS_FILE = path.join(BASE_DIR, "users.json");
var REGISTRATIONS_FILE = path.join(BASE_DIR, "registrations.json");
var MATCHES_FILE = path.join(BASE_DIR, "matches.json");
var TOURNAMENTS_FILE = path.join(BASE_DIR, "tournaments.json");
var ANNOUNCEMENTS_FILE = path.join(BASE_DIR, "announcements.json");

var ADMIN_USERNAME = "admin";
var ADMIN_PASSWORD = "nepplay@123";

var PAYMENT_SETTINGS = {
    eSewa: { name: "eSewa", number: "9748835184" },
    Khalti: { name: "Khalti", number: "97766258368" }
};

var sessions = new Map();
var SESSION_COOKIE = "nepplay_session";

var DEFAULT_TOURNAMENTS = [
    { id: "free-fire", name: "Free Fire Championship", game: "Free Fire",
      date: "2026-09-20", time: "7:00 PM", entryFee: 100, teamSize: 4,
      maxTeams: 48, prizePool: 10000, status: "Open" },
    { id: "pubg-mobile", name: "PUBG Mobile Championship", game: "PUBG Mobile",
      date: "2026-09-25", time: "6:00 PM", entryFee: 200, teamSize: 4,
      maxTeams: 32, prizePool: 15000, status: "Open" },
    { id: "mobile-legends", name: "Mobile Legends Championship", game: "Mobile Legends",
      date: "2026-09-30", time: "5:00 PM", entryFee: 150, teamSize: 5,
      maxTeams: 24, prizePool: 12000, status: "Open" }
];

/* ============ FILE HELPERS ============ */

function ensureFile(p, d) {
    try {
        if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf8");
    } catch (e) { console.log("Could not create:", p, e.message); }
}

function readJSON(p, d) {
    try {
        if (!fs.existsSync(p)) {
            fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf8");
            return d;
        }
        var t = fs.readFileSync(p, "utf8");
        if (!t || !t.trim()) return d;
        var data = JSON.parse(t);
        if (data === null || data === undefined) return d;
        return data;
    } catch (e) {
        console.log("JSON read error:", p, e.message);
        return d;
    }
}

function writeJSON(p, data) {
    try {
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
        return true;
    } catch (e) {
        console.log("JSON write error:", p, e.message);
        return false;
    }
}

ensureFile(USERS_FILE, []);
ensureFile(REGISTRATIONS_FILE, []);
ensureFile(MATCHES_FILE, []);
ensureFile(TOURNAMENTS_FILE, DEFAULT_TOURNAMENTS);
ensureFile(ANNOUNCEMENTS_FILE, []);

/* ============ DATA GETTERS ============ */

function getUsers() { var u = readJSON(USERS_FILE, []); return Array.isArray(u) ? u : []; }
function getRegistrations() { var r = readJSON(REGISTRATIONS_FILE, []); return Array.isArray(r) ? r : []; }
function getMatches() { var m = readJSON(MATCHES_FILE, []); return Array.isArray(m) ? m : []; }
function getAnnouncements() { var a = readJSON(ANNOUNCEMENTS_FILE, []); return Array.isArray(a) ? a : []; }
function getTournaments() {
    var t = readJSON(TOURNAMENTS_FILE, DEFAULT_TOURNAMENTS);
    if (!Array.isArray(t)) t = DEFAULT_TOURNAMENTS;
    if (t.length === 0) t = DEFAULT_TOURNAMENTS;
    return t;
}

/* ============ HELPERS ============ */

function createId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
}
function nowISO() { return new Date().toISOString(); }
function cleanString(v) { if (v === undefined || v === null) return ""; return String(v).trim(); }
function safeNumber(v, f) { var n = Number(v); return isNaN(n) ? f : n; }

function normalizeStatus(v) {
    var s = cleanString(v);
    if (!s) return "Pending";
    var l = s.toLowerCase();
    if (l === "approved") return "Approved";
    if (l === "rejected") return "Rejected";
    if (l === "pending") return "Pending";
    return s;
}

function normalizeMatchType(v) {
    var s = cleanString(v).toLowerCase();
    if (s === "battle-royale" || s === "battle_royale" || s === "br" ||
        s === "royale" || s === "battle royale") {
        return "battle-royale";
    }
    return "1v1";
}

/* ============ PASSWORD ============ */

function createPassword(password) {
    password = String(password);
    var salt = crypto.randomBytes(16).toString("hex");
    var hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
    return { passwordHash: hash, passwordSalt: salt };
}

function verifyPassword(password, user) {
    try {
        if (!user) return false;
        password = String(password);
        var storedHash = cleanString(user.passwordHash);
        var salt = cleanString(user.passwordSalt);
        if (!storedHash || !salt) return false;
        var calc = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
        var a = Buffer.from(calc, "hex");
        var b = Buffer.from(storedHash, "hex");
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (e) {
        console.log("Password verify error:", e.message);
        return false;
    }
}

function safeUser(u) {
    if (!u) return null;
    return { id: u.id || "", username: u.username || "", email: u.email || "", createdAt: u.createdAt || "" };
}

/* ============ COOKIES ============ */

function parseCookies(req) {
    var c = {};
    var h = req.headers.cookie;
    if (!h) return c;
    h.split(";").forEach(function (part) {
        var p = part.split("=");
        var k = p.shift();
        if (!k) return;
        var v = p.join("=");
        try { c[k.trim()] = decodeURIComponent(v); }
        catch (e) { c[k.trim()] = v; }
    });
    return c;
}

function getSession(req) {
    var c = parseCookies(req);
    var id = c[SESSION_COOKIE];
    if (!id) return null;
    var s = sessions.get(id);
    if (!s) return null;
    if (s.expiresAt < Date.now()) { sessions.delete(id); return null; }
    return s;
}

function createSession(userId, role) {
    var id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, {
        userId: userId, role: role,
        createdAt: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
    });
    return id;
}

function setSessionCookie(h, id) {
    h["Set-Cookie"] = SESSION_COOKIE + "=" + encodeURIComponent(id) +
        "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800";
}

function clearSessionCookie(h) {
    h["Set-Cookie"] = SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

/* ============ RESPONSES ============ */

function sendJSON(res, code, data, extra) {
    var h = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Credentials": "true"
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    res.writeHead(code, h);
    res.end(JSON.stringify(data));
}

function sendError(res, code, msg) {
    sendJSON(res, code, { success: false, error: msg, message: msg });
}

function readBody(req, cb) {
    var body = "";
    req.on("data", function (chunk) {
        body += chunk.toString();
        if (body.length > 5 * 1024 * 1024) { try { req.destroy(); } catch (e) {} }
    });
    req.on("end", function () {
        if (!body) { cb(null, {}); return; }
        try { cb(null, JSON.parse(body)); }
        catch (e) { cb(new Error("Invalid JSON data.")); }
    });
}

/* ============ AUTH ============ */

function getLoggedInUser(req) {
    var s = getSession(req);
    if (!s || s.role !== "member") return null;
    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
        if (String(users[i].id) === String(s.userId)) return users[i];
    }
    return null;
}

function requireMember(req, res) {
    var u = getLoggedInUser(req);
    if (!u) { sendError(res, 401, "Please login first."); return null; }
    return u;
}

function requireAdmin(req, res) {
    var s = getSession(req);
    if (!s || s.role !== "admin") {
        sendError(res, 401, "Admin login required.");
        return false;
    }
    return true;
}

/* ============ TOURNAMENT HELPERS ============ */

function findTournament(idOrName) {
    var list = getTournaments();
    var q = cleanString(idOrName).toLowerCase();
    if (!q) return null;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id || "").toLowerCase() === q ||
            String(list[i].name || "").toLowerCase() === q) {
            return list[i];
        }
    }
    return null;
}

function countTournamentRegistrations(tid) {
    var regs = getRegistrations();
    var c = 0;
    for (var i = 0; i < regs.length; i++) {
        if (String(regs[i].tournamentId || "") === String(tid || "")) {
            if (normalizeStatus(regs[i].status) !== "Rejected") c++;
        }
    }
    return c;
}

function tournamentForClient(t) {
    var reg = countTournamentRegistrations(t.id);
    var max = safeNumber(t.maxTeams, 0);
    var remaining = max - reg;
    if (remaining < 0) remaining = 0;
    var r = {};
    Object.keys(t).forEach(function (k) { r[k] = t[k]; });
    r.registeredTeams = reg;
    r.remainingSlots = remaining;
    r.isFull = max > 0 && reg >= max;
    return r;
}

function registrationForClient(reg) {
    var r = {};
    Object.keys(reg).forEach(function (k) { r[k] = reg[k]; });
    r.status = normalizeStatus(reg.status);
    return r;
}

/* ============ LEADERBOARD (with BR support) ============ */

function isCompletedMatch(m) {
    var s = String(m.status || "").toLowerCase().trim();
    return s === "completed" || s === "complete" ||
           s === "finished" || s === "finish";
}

function teamKey(n) {
    return String(n || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function buildLeaderboard(gameFilter) {
    var matches = getMatches();
    var tournaments = getTournaments();
    var tGames = {};
    for (var t = 0; t < tournaments.length; t++) {
        tGames[String(tournaments[t].id || "")] = String(tournaments[t].game || "");
    }
    var teamsByName = {};
    var counted = 0;
    var tSeen = {};

    function ensureTeam(name, captain, game) {
        var k = teamKey(name);
        if (!teamsByName[k]) {
            teamsByName[k] = {
                name: name, captain: captain || "",
                games: {}, played: 0, wins: 0, losses: 0,
                ties: 0, points: 0, brPlacements: { first: 0, second: 0, third: 0 }
            };
        }
        if (game) teamsByName[k].games[game] = true;
        return teamsByName[k];
    }

    for (var m = 0; m < matches.length; m++) {
        var match = matches[m];
        if (!isCompletedMatch(match)) continue;
        var g = cleanString(match.game) ||
                tGames[String(match.tournamentId || "")] || "";
        if (gameFilter && gameFilter !== "all" &&
            g.toLowerCase() !== gameFilter.toLowerCase()) continue;

        var matchType = normalizeMatchType(match.matchType);

        if (matchType === "battle-royale") {
            /* BR: use winners array (top 3) */
            var winnersArr = Array.isArray(match.winners) ? match.winners : [];
            if (winnersArr.length === 0 && match.winner) {
                /* Fallback: single winner stored as string */
                winnersArr = [match.winner];
            }
            if (winnersArr.length === 0) continue;

            counted++;
            if (match.tournamentId) tSeen[String(match.tournamentId)] = true;

            for (var wi = 0; wi < winnersArr.length; wi++) {
                var teamName = cleanString(winnersArr[wi]);
                if (!teamName) continue;
                var team = ensureTeam(teamName, "", g);
                team.played++;
                if (wi === 0) {
                    team.wins++;
                    team.points += 3;
                    team.brPlacements.first++;
                } else if (wi === 1) {
                    team.points += 2;
                    team.brPlacements.second++;
                } else if (wi === 2) {
                    team.points += 1;
                    team.brPlacements.third++;
                }
            }
            continue;
        }

        /* 1v1 match (default) */
        var t1 = cleanString(match.team1);
        var t2 = cleanString(match.team2);
        if (!t1 || !t2) continue;

        counted++;
        if (match.tournamentId) tSeen[String(match.tournamentId)] = true;

        var w = cleanString(match.winner);
        var k1 = teamKey(t1), k2 = teamKey(t2);
        var e1 = ensureTeam(t1, cleanString(match.captainName), g);
        var e2 = ensureTeam(t2, cleanString(match.captainName), g);

        e1.played++;
        e2.played++;

        var wk = teamKey(w);
        if (!w || wk === "") {
            e1.ties++; e2.ties++;
            e1.points += 1; e2.points += 1;
        } else if (wk === k1) {
            e1.wins++; e1.points += 3;
            e2.losses++;
        } else if (wk === k2) {
            e2.wins++; e2.points += 3;
            e1.losses++;
        } else {
            e1.ties++; e2.ties++;
            e1.points += 1; e2.points += 1;
        }
    }

    var list = [];
    Object.keys(teamsByName).forEach(function (k) {
        var t = teamsByName[k];
        list.push({
            name: t.name, captain: t.captain,
            games: Object.keys(t.games),
            played: t.played, wins: t.wins,
            losses: t.losses, ties: t.ties,
            points: t.points,
            brPlacements: t.brPlacements
        });
    });

    list.sort(function (a, b) {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return String(a.name).localeCompare(String(b.name));
    });

    return {
        teams: list, totalTeams: list.length,
        totalMatches: counted,
        totalTournaments: Object.keys(tSeen).length
    };
}

/* ============ WINNERS (Hall of Champions, with BR) ============ */

function buildWinners() {
    var matches = getMatches();
    var tournaments = getTournaments();
    var winners = [];

    for (var t = 0; t < tournaments.length; t++) {
        var tour = tournaments[t];
        var tid = String(tour.id || "");
        var completed = [];

        for (var m = 0; m < matches.length; m++) {
            var match = matches[m];
            if (String(match.tournamentId || "") !== tid) continue;
            if (!isCompletedMatch(match)) continue;

            var mt = normalizeMatchType(match.matchType);
            if (mt === "battle-royale") {
                var wArr = Array.isArray(match.winners) ? match.winners : [];
                if (wArr.length === 0 && match.winner) wArr = [match.winner];
                if (wArr.length === 0) continue;
            } else {
                if (!match.winner) continue;
            }
            completed.push(match);
        }

        if (completed.length === 0) continue;

        completed.sort(function (a, b) {
            var da = (a.date || "") + "T" + (a.time || "00:00");
            var db = (b.date || "") + "T" + (b.time || "00:00");
            return new Date(da) - new Date(db);
        });

        var final = completed[completed.length - 1];
        var mtFinal = normalizeMatchType(final.matchType);

        var champion = "", runnerUp = "";
        var champScore = "", runScore = "";

        if (mtFinal === "battle-royale") {
            var wA = Array.isArray(final.winners) ? final.winners : [];
            if (wA.length === 0 && final.winner) wA = [final.winner];
            champion = cleanString(wA[0] || "");
            runnerUp = cleanString(wA[1] || "");
        } else {
            champion = cleanString(final.winner);
            var t1 = cleanString(final.team1);
            var t2 = cleanString(final.team2);
            var ck = teamKey(champion);
            if (ck !== teamKey(t1) && ck !== teamKey(t2)) continue;
            runnerUp = (ck === teamKey(t1)) ? t2 : t1;
            champScore = cleanString(final.scoreTeam1);
            runScore = cleanString(final.scoreTeam2);
        }

        if (!champion) continue;

        var cCapt = "", rCapt = "";
        var regs = getRegistrations();
        for (var r = 0; r < regs.length; r++) {
            var reg = regs[r];
            if (String(reg.tournamentId || "") !== tid) continue;
            var rt = cleanString(reg.teamName);
            if (teamKey(rt) === teamKey(champion)) cCapt = cleanString(reg.captainName);
            if (teamKey(rt) === teamKey(runnerUp)) rCapt = cleanString(reg.captainName);
        }

        winners.push({
            tournamentId: tour.id || "",
            tournamentName: tour.name || "Tournament",
            game: tour.game || "",
            date: tour.date || final.date || "",
            time: tour.time || final.time || "",
            entryFee: safeNumber(tour.entryFee, 0),
            prizePool: safeNumber(tour.prizePool, 0),
            maxTeams: safeNumber(tour.maxTeams, 0),
            champion: champion,
            championCaptain: cCapt,
            runnerUp: runnerUp,
            runnerUpCaptain: rCapt,
            championScore: champScore,
            runnerUpScore: runScore,
            matchType: mtFinal,
            finalMatchName: cleanString(final.result || final.name),
            completedAt: final.updatedAt || final.createdAt || "",
            totalMatches: completed.length
        });
    }

    winners.sort(function (a, b) {
        var da = (a.date || "") + "T" + (a.time || "00:00");
        var db = (b.date || "") + "T" + (b.time || "00:00");
        return new Date(db) - new Date(da);
    });

    return winners;
}

/* ============ STATIC ============ */

var MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};

function serveStatic(req, res, pathname) {
    var decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch (e) { sendError(res, 400, "Invalid URL."); return; }

    if (decoded === "/") decoded = "/index.html";

    var safe = path.normalize(decoded).replace(/^(\.\.[\/\\])+/, "");
    var filePath = path.join(BASE_DIR, safe);

    var nb = path.resolve(BASE_DIR);
    var nf = path.resolve(filePath);
    if (nf !== nb && nf.indexOf(nb + path.sep) !== 0) {
        sendError(res, 403, "Access denied."); return;
    }

    fs.stat(filePath, function (err, stats) {
        if (err || !stats.isFile()) { sendError(res, 404, "File not found."); return; }
        var ext = path.extname(filePath).toLowerCase();
        var ct = MIME[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-cache" });
        var stream = fs.createReadStream(filePath);
        stream.on("error", function () { sendError(res, 500, "Read error."); });
        stream.pipe(res);
    });
}

/* ============ API ============ */

function handleAPI(req, res, pathname, query) {

    /* USER REGISTER */
    if (req.method === "POST" && pathname === "/api/users/register") {
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var username = cleanString(body.username);
            var email = cleanString(body.email).toLowerCase();
            var password = cleanString(body.password);
            if (!username) { sendError(res, 400, "Username is required."); return; }
            if (!email) { sendError(res, 400, "Email is required."); return; }
            if (!password) { sendError(res, 400, "Password is required."); return; }
            if (password.length < 4) { sendError(res, 400, "Password min 4 chars."); return; }

            var users = getUsers();
            for (var i = 0; i < users.length; i++) {
                if (String(users[i].username || "").toLowerCase() === username.toLowerCase()) {
                    sendError(res, 409, "Username already exists."); return;
                }
                if (String(users[i].email || "").toLowerCase() === email) {
                    sendError(res, 409, "Email already exists."); return;
                }
            }

            var pd = createPassword(password);
            var user = {
                id: createId("user"), username: username, email: email,
                passwordHash: pd.passwordHash, passwordSalt: pd.passwordSalt,
                createdAt: nowISO()
            };
            users.push(user);
            if (!writeJSON(USERS_FILE, users)) {
                sendError(res, 500, "Could not save account."); return;
            }
            sendJSON(res, 201, { success: true, message: "Account created.", user: safeUser(user) });
        });
        return true;
    }

    /* LOGIN */
    if (req.method === "POST" && (pathname === "/api/users/login" || pathname === "/api/member/login")) {
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var identifier = cleanString(body.login) || cleanString(body.username) ||
                cleanString(body.email) || cleanString(body.userId);
            var password = cleanString(body.password);
            if (!identifier || !password) {
                sendError(res, 400, "Username/email and password required."); return;
            }
            var users = getUsers();
            var found = null;
            for (var i = 0; i < users.length; i++) {
                var u = users[i];
                if (String(u.id || "") === identifier ||
                    String(u.username || "").toLowerCase() === identifier.toLowerCase() ||
                    String(u.email || "").toLowerCase() === identifier.toLowerCase()) {
                    found = u; break;
                }
            }
            if (!found) { sendError(res, 401, "Invalid credentials."); return; }
            if (!verifyPassword(password, found)) { sendError(res, 401, "Invalid credentials."); return; }
            var sid = createSession(found.id, "member");
            var h = {};
            setSessionCookie(h, sid);
            sendJSON(res, 200, { success: true, message: "Login successful.", user: safeUser(found) }, h);
        });
        return true;
    }

    /* ME */
    if (req.method === "GET" && pathname === "/api/users/me") {
        var u = getLoggedInUser(req);
        if (!u) { sendJSON(res, 401, { success: false, loggedIn: false, user: null }); return true; }
        sendJSON(res, 200, { success: true, loggedIn: true, user: safeUser(u) });
        return true;
    }

    /* LOGOUT */
    if (req.method === "POST" && pathname === "/api/users/logout") {
        var c = parseCookies(req);
        if (c[SESSION_COOKIE]) sessions.delete(c[SESSION_COOKIE]);
        var h = {};
        clearSessionCookie(h);
        sendJSON(res, 200, { success: true, message: "Logged out." }, h);
        return true;
    }

    /* MY REGISTRATIONS */
    if (req.method === "GET" && pathname === "/api/users/registrations") {
        var m = requireMember(req, res);
        if (!m) return true;
        var all = getRegistrations();
        var mine = [];
        for (var i = 0; i < all.length; i++) {
            if (String(all[i].userId || "") === String(m.id || "")) {
                mine.push(registrationForClient(all[i]));
            }
        }
        sendJSON(res, 200, { success: true, registrations: mine });
        return true;
    }

    /* PUBLIC TOURNAMENTS */
    if (req.method === "GET" && pathname === "/api/tournaments") {
        var list = getTournaments();
        var out = [];
        for (var i = 0; i < list.length; i++) out.push(tournamentForClient(list[i]));
        sendJSON(res, 200, { success: true, tournaments: out });
        return true;
    }

    /* SINGLE TOURNAMENT */
    if (req.method === "GET" && pathname === "/api/tournaments/one") {
        var key = query.get("id") || query.get("tournamentId") || query.get("tournament");
        var t = findTournament(key);
        if (!t) { sendError(res, 404, "Tournament not found."); return true; }
        sendJSON(res, 200, { success: true, tournament: tournamentForClient(t) });
        return true;
    }

    /* CREATE TOURNAMENT */
    if (req.method === "POST" && pathname === "/api/tournaments") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var name = cleanString(body.name);
            if (!name) { sendError(res, 400, "Tournament name required."); return; }
            var list = getTournaments();
            var nt = {
                id: createId("tour"), name: name,
                game: cleanString(body.game) || "Free Fire",
                date: cleanString(body.date), time: cleanString(body.time),
                entryFee: safeNumber(body.entryFee, 0),
                teamSize: safeNumber(body.teamSize, 4),
                maxTeams: safeNumber(body.maxTeams, 16),
                prizePool: safeNumber(body.prizePool, 0),
                status: cleanString(body.status) || "Upcoming",
                createdAt: nowISO()
            };
            list.push(nt);
            if (!writeJSON(TOURNAMENTS_FILE, list)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 201, { success: true, message: "Tournament created.", tournament: nt });
        });
        return true;
    }

    /* UPDATE TOURNAMENT */
    if (req.method === "PUT" && pathname.indexOf("/api/tournaments/") === 0 &&
        pathname.indexOf("/api/tournaments/one") !== 0) {
        if (!requireAdmin(req, res)) return true;
        var upId = decodeURIComponent(pathname.replace("/api/tournaments/", ""));
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var list = getTournaments();
            var found = null;
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].id) === String(upId)) { found = list[i]; break; }
            }
            if (!found) { sendError(res, 404, "Not found."); return; }
            ["name","game","date","time","status"].forEach(function (k) {
                if (body[k] !== undefined && body[k] !== null) found[k] = cleanString(body[k]);
            });
            if (body.entryFee !== undefined) found.entryFee = safeNumber(body.entryFee, found.entryFee);
            if (body.teamSize !== undefined) found.teamSize = safeNumber(body.teamSize, found.teamSize);
            if (body.maxTeams !== undefined) found.maxTeams = safeNumber(body.maxTeams, found.maxTeams);
            if (body.prizePool !== undefined) found.prizePool = safeNumber(body.prizePool, found.prizePool);
            found.updatedAt = nowISO();
            if (!writeJSON(TOURNAMENTS_FILE, list)) {
                sendError(res, 500, "Could not update."); return;
            }
            sendJSON(res, 200, { success: true, message: "Tournament updated.", tournament: found });
        });
        return true;
    }

    /* DELETE TOURNAMENT */
    if (req.method === "DELETE" && pathname.indexOf("/api/tournaments/") === 0) {
        if (!requireAdmin(req, res)) return true;
        var delId = decodeURIComponent(pathname.replace("/api/tournaments/", ""));
        var list = getTournaments();
        var rem = [], found = false;
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(delId)) { found = true; continue; }
            rem.push(list[i]);
        }
        if (!found) { sendError(res, 404, "Not found."); return true; }
        if (!writeJSON(TOURNAMENTS_FILE, rem)) {
            sendError(res, 500, "Could not delete."); return true;
        }
        sendJSON(res, 200, { success: true, message: "Deleted." });
        return true;
    }

    /* CREATE REGISTRATION */
    if (req.method === "POST" && pathname === "/api/registrations") {
        var user = requireMember(req, res);
        if (!user) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var tid = cleanString(body.tournamentId || body.tournament);
            var tour = findTournament(tid);
            if (!tour) { sendError(res, 404, "Tournament not found."); return; }
            var ts = cleanString(tour.status).toLowerCase();
            if (ts === "closed" || ts === "completed") {
                sendError(res, 400, "Tournament is closed."); return;
            }
            var cnt = countTournamentRegistrations(tour.id);
            var max = safeNumber(tour.maxTeams, 0);
            if (max > 0 && cnt >= max) {
                sendError(res, 400, "Tournament is full."); return;
            }
            var pm = cleanString(body.paymentMethod || (body.payment && body.payment.method));
            var txId = cleanString(body.transactionId || (body.payment && body.payment.transactionId));
            var fee = safeNumber(tour.entryFee, 0);
            if (fee > 0) {
                if (pm !== "Khalti" && pm !== "eSewa") {
                    sendError(res, 400, "Select Khalti or eSewa."); return;
                }
                if (txId.length < 3 || txId.length > 100) {
                    sendError(res, 400, "Invalid transaction ID."); return;
                }
            } else if (!pm) pm = "Free";

            var regs = getRegistrations();
            for (var d = 0; d < regs.length; d++) {
                if (txId && String(regs[d].transactionId || "").toLowerCase() === txId.toLowerCase()) {
                    sendError(res, 409, "Transaction ID already used."); return;
                }
            }

            var reg = {
                id: createId("reg"),
                userId: user.id, username: user.username, email: user.email,
                tournamentId: tour.id, tournamentName: tour.name, game: tour.game,
                teamName: cleanString(body.teamName),
                captainName: cleanString(body.captainName || body.captain),
                phone: cleanString(body.phone),
                player1: cleanString(body.player1), player2: cleanString(body.player2),
                player3: cleanString(body.player3), player4: cleanString(body.player4),
                player5: cleanString(body.player5), player6: cleanString(body.player6),
                payerName: cleanString(body.payerName), payerPhone: cleanString(body.payerPhone),
                paymentMethod: pm, transactionId: txId, amount: fee,
                paymentStatus: fee > 0 ? "Pending" : "Not Required",
                status: "Pending",
                message: cleanString(body.message),
                createdAt: nowISO(), updatedAt: nowISO()
            };
            if (!reg.teamName) { sendError(res, 400, "Team name required."); return; }
            if (!reg.captainName) { sendError(res, 400, "Captain name required."); return; }
            regs.push(reg);
            if (!writeJSON(REGISTRATIONS_FILE, regs)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 201, {
                success: true,
                message: "Registration submitted. Admin will verify payment.",
                registration: registrationForClient(reg)
            });
        });
        return true;
    }

    /* PUBLIC REGISTRATIONS */
    if (req.method === "GET" && pathname === "/api/registrations") {
        var all = getRegistrations();
        var out = [];
        for (var i = 0; i < all.length; i++) {
            if (normalizeStatus(all[i].status) !== "Rejected") {
                out.push(registrationForClient(all[i]));
            }
        }
        sendJSON(res, 200, { success: true, registrations: out });
        return true;
    }

    /* PUBLIC MATCHES */
    if (req.method === "GET" && pathname === "/api/matches") {
        sendJSON(res, 200, { success: true, matches: getMatches() });
        return true;
    }

    /* MEMBER MATCHES (with BR + joined tracking) */
    if (req.method === "GET" && pathname === "/api/member/matches") {
        var mem = requireMember(req, res);
        if (!mem) return true;
        var regs = getRegistrations();
        var myTids = {};
        for (var i = 0; i < regs.length; i++) {
            if (String(regs[i].userId || "") !== String(mem.id || "")) continue;
            if (normalizeStatus(regs[i].status) !== "Approved") continue;
            myTids[String(regs[i].tournamentId || "")] = true;
        }
        var matches = getMatches();
        var tours = getTournaments();
        var tMap = {};
        for (var j = 0; j < tours.length; j++) tMap[String(tours[j].id || "")] = tours[j];

        var out = [];
        for (var k = 0; k < matches.length; k++) {
            var mm = matches[k];
            var tid = String(mm.tournamentId || "");
            if (!myTids[tid]) continue;
            var t = tMap[tid] || {};

            var em = {};
            Object.keys(mm).forEach(function (key) { em[key] = mm[key]; });

            em.matchType = normalizeMatchType(mm.matchType);

            em.tournament = {
                id: t.id || "", name: t.name || mm.tournamentName || "",
                game: t.game || mm.game || "", date: t.date || "", time: t.time || "",
                entryFee: t.entryFee || 0, prizePool: t.prizePool || 0,
                teamSize: t.teamSize || 0
            };

            /* Did this member mark "I'm in the room"? */
            var joined = Array.isArray(mm.joinedUserIds) ? mm.joinedUserIds : [];
            em.memberJoined = false;
            for (var ji = 0; ji < joined.length; ji++) {
                if (String(joined[ji]) === String(mem.id)) { em.memberJoined = true; break; }
            }

            out.push(em);
        }
        out.sort(function (a, b) {
            var da = (a.date || "") + "T" + (a.time || "00:00");
            var db = (b.date || "") + "T" + (b.time || "00:00");
            return new Date(da) - new Date(db);
        });
        sendJSON(res, 200, { success: true, matches: out });
        return true;
    }

    /* MEMBER JOINS MATCH (marks "I'm in the room") */
    if (req.method === "POST" && pathname === "/api/member/join-match") {
        var jUser = requireMember(req, res);
        if (!jUser) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var mid = cleanString(body.matchId || body.id);
            if (!mid) { sendError(res, 400, "Match ID required."); return; }
            var matches = getMatches();
            var found = null;
            for (var i = 0; i < matches.length; i++) {
                if (String(matches[i].id) === String(mid)) { found = matches[i]; break; }
            }
            if (!found) { sendError(res, 404, "Match not found."); return; }

            if (!Array.isArray(found.joinedUserIds)) found.joinedUserIds = [];
            /* Avoid duplicates */
            var already = false;
            for (var j = 0; j < found.joinedUserIds.length; j++) {
                if (String(found.joinedUserIds[j]) === String(jUser.id)) { already = true; break; }
            }
            if (!already) found.joinedUserIds.push(jUser.id);

            found.updatedAt = nowISO();

            if (!writeJSON(MATCHES_FILE, matches)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 200, { success: true, message: "Joined!", joined: true });
        });
        return true;
    }

    /* LEADERBOARD */
    if (req.method === "GET" && pathname === "/api/leaderboard") {
        var gf = query.get("game") || "all";
        var r = buildLeaderboard(gf);
        sendJSON(res, 200, {
            success: true, teams: r.teams,
            totalTeams: r.totalTeams, totalMatches: r.totalMatches,
            totalTournaments: r.totalTournaments, filter: gf
        });
        return true;
    }

    /* WINNERS */
    if (req.method === "GET" && pathname === "/api/winners") {
        var w = buildWinners();
        sendJSON(res, 200, { success: true, winners: w, totalTournaments: w.length });
        return true;
    }

    /* PUBLIC ANNOUNCEMENTS */
    if (req.method === "GET" && pathname === "/api/announcements") {
        var ann = getAnnouncements();
        ann.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        var lim = query.get("limit");
        if (lim) {
            var ln = safeNumber(lim, 0);
            if (ln > 0) ann = ann.slice(0, ln);
        }
        sendJSON(res, 200, { success: true, announcements: ann });
        return true;
    }

    /* ADMIN LOGIN */
    if (req.method === "POST" && pathname === "/api/admin/login") {
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var u = cleanString(body.username);
            var p = cleanString(body.password);
            if (u !== ADMIN_USERNAME || p !== ADMIN_PASSWORD) {
                sendError(res, 401, "Invalid admin credentials."); return;
            }
            var sid = createSession("admin", "admin");
            var h = {};
            setSessionCookie(h, sid);
            sendJSON(res, 200, {
                success: true, message: "Admin login successful.",
                admin: { username: ADMIN_USERNAME }
            }, h);
        });
        return true;
    }

    /* ADMIN CHECK */
    if (req.method === "GET" && pathname === "/api/admin/check") {
        var s = getSession(req);
        if (!s || s.role !== "admin") {
            sendJSON(res, 401, { success: false, loggedIn: false });
            return true;
        }
        sendJSON(res, 200, { success: true, loggedIn: true, admin: { username: ADMIN_USERNAME } });
        return true;
    }

    /* ADMIN LOGOUT */
    if (req.method === "POST" && pathname === "/api/admin/logout") {
        var c = parseCookies(req);
        if (c[SESSION_COOKIE]) sessions.delete(c[SESSION_COOKIE]);
        var h = {};
        clearSessionCookie(h);
        sendJSON(res, 200, { success: true, message: "Admin logged out." }, h);
        return true;
    }

    /* ADMIN REGISTRATIONS */
    if (req.method === "GET" && pathname === "/api/admin/registrations") {
        if (!requireAdmin(req, res)) return true;
        var all = getRegistrations();
        var out = [];
        for (var i = 0; i < all.length; i++) out.push(registrationForClient(all[i]));
        sendJSON(res, 200, { success: true, registrations: out });
        return true;
    }

    /* ADMIN REG STATUS (body) */
    if (req.method === "PUT" && pathname === "/api/admin/registrations/status") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var rid = cleanString(body.registrationId || body.id);
            var st = normalizeStatus(body.status);
            if (!rid) { sendError(res, 400, "ID required."); return; }
            if (st !== "Pending" && st !== "Approved" && st !== "Rejected") {
                sendError(res, 400, "Invalid status."); return;
            }
            var regs = getRegistrations();
            var found = null;
            for (var i = 0; i < regs.length; i++) {
                if (String(regs[i].id) === String(rid)) {
                    regs[i].status = st;
                    regs[i].updatedAt = nowISO();
                    if (st === "Approved") regs[i].paymentStatus = "Verified";
                    if (st === "Rejected") regs[i].paymentStatus = "Rejected";
                    found = regs[i]; break;
                }
            }
            if (!found) { sendError(res, 404, "Not found."); return; }
            if (!writeJSON(REGISTRATIONS_FILE, regs)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 200, {
                success: true, message: "Status updated.",
                registration: registrationForClient(found)
            });
        });
        return true;
    }

    /* ADMIN REG STATUS (URL) */
    if (req.method === "PUT" && pathname.indexOf("/api/admin/registrations/") === 0 &&
        pathname.indexOf("/status") !== -1) {
        if (!requireAdmin(req, res)) return true;
        var raw = pathname.replace("/api/admin/registrations/", "");
        var rid = decodeURIComponent(raw.replace(/\/status$/, ""));
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var st = normalizeStatus(body.status);
            if (st !== "Pending" && st !== "Approved" && st !== "Rejected") {
                sendError(res, 400, "Invalid status."); return;
            }
            var regs = getRegistrations();
            var found = null;
            for (var i = 0; i < regs.length; i++) {
                if (String(regs[i].id) === String(rid)) {
                    regs[i].status = st;
                    regs[i].updatedAt = nowISO();
                    if (st === "Approved") regs[i].paymentStatus = "Verified";
                    if (st === "Rejected") regs[i].paymentStatus = "Rejected";
                    found = regs[i]; break;
                }
            }
            if (!found) { sendError(res, 404, "Not found."); return; }
            if (!writeJSON(REGISTRATIONS_FILE, regs)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 200, {
                success: true, message: "Status updated.",
                registration: registrationForClient(found)
            });
        });
        return true;
    }

    /* ADMIN REG EDIT */
    if (req.method === "PUT" && pathname === "/api/admin/registrations") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var rid = cleanString(body.id || body.registrationId);
            if (!rid) { sendError(res, 400, "ID required."); return; }
            var regs = getRegistrations();
            var found = null;
            for (var i = 0; i < regs.length; i++) {
                if (String(regs[i].id) === String(rid)) { found = regs[i]; break; }
            }
            if (!found) { sendError(res, 404, "Not found."); return; }
            var fields = ["teamName","captainName","phone","player1","player2","player3",
                "player4","player5","player6","payerName","payerPhone","paymentMethod",
                "transactionId","message","status","paymentStatus"];
            fields.forEach(function (f) {
                if (body[f] !== undefined && body[f] !== null) found[f] = cleanString(body[f]);
            });
            found.updatedAt = nowISO();
            if (!writeJSON(REGISTRATIONS_FILE, regs)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 200, {
                success: true, message: "Updated.",
                registration: registrationForClient(found)
            });
        });
        return true;
    }

    /* ADMIN REG DELETE */
    if (req.method === "DELETE" && pathname === "/api/admin/registrations") {
        if (!requireAdmin(req, res)) return true;
        var rid = cleanString(query.get("id") || query.get("registrationId"));
        if (!rid) { sendError(res, 400, "ID required."); return true; }
        var regs = getRegistrations();
        var rem = [], del = false;
        for (var i = 0; i < regs.length; i++) {
            if (String(regs[i].id) === String(rid)) { del = true; continue; }
            rem.push(regs[i]);
        }
        if (!del) { sendError(res, 404, "Not found."); return true; }
        if (!writeJSON(REGISTRATIONS_FILE, rem)) {
            sendError(res, 500, "Could not delete."); return true;
        }
        sendJSON(res, 200, { success: true, message: "Deleted." });
        return true;
    }

    /* ADMIN TOURNAMENTS */
    if (req.method === "GET" && pathname === "/api/admin/tournaments") {
        if (!requireAdmin(req, res)) return true;
        var list = getTournaments();
        var out = [];
        for (var i = 0; i < list.length; i++) out.push(tournamentForClient(list[i]));
        sendJSON(res, 200, { success: true, tournaments: out });
        return true;
    }

    /* ADMIN MATCHES */
    if (req.method === "GET" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return true;
        sendJSON(res, 200, { success: true, matches: getMatches() });
        return true;
    }

    /* CREATE MATCH (with BR support) */
    if (req.method === "POST" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var matches = getMatches();
            var matchType = normalizeMatchType(body.matchType);

            /* BR: winners is array of up to 3 team names */
            var winners = [];
            if (Array.isArray(body.winners)) {
                winners = body.winners.map(cleanString).filter(function (x) { return x !== ""; });
                winners = winners.slice(0, 3);
            }

            var match = {
                id: createId("match"),
                matchType: matchType,
                game: cleanString(body.game),
                tournamentId: cleanString(body.tournamentId),
                tournamentName: cleanString(body.tournamentName),
                team1: cleanString(body.team1),
                team2: cleanString(body.team2),
                scoreTeam1: cleanString(body.scoreTeam1 || body.score1),
                scoreTeam2: cleanString(body.scoreTeam2 || body.score2),
                winner: cleanString(body.winner || (winners[0] || "")),
                winners: winners,
                date: cleanString(body.date),
                time: cleanString(body.time),
                status: cleanString(body.status) || "Upcoming",
                roomId: cleanString(body.roomId),
                roomPassword: cleanString(body.roomPassword),
                result: cleanString(body.result),
                notes: cleanString(body.notes),
                joinedUserIds: [],
                createdAt: nowISO(),
                updatedAt: nowISO()
            };
            matches.push(match);
            if (!writeJSON(MATCHES_FILE, matches)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 201, { success: true, message: "Match created.", match: match });
        });
        return true;
    }

    /* UPDATE MATCH */
    if (req.method === "PUT" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var mid = cleanString(body.id || body.matchId);
            if (!mid) { sendError(res, 400, "ID required."); return; }
            var matches = getMatches();
            var found = null;
            for (var i = 0; i < matches.length; i++) {
                if (String(matches[i].id) === String(mid)) { found = matches[i]; break; }
            }
            if (!found) { sendError(res, 404, "Not found."); return; }

            if (body.matchType !== undefined) {
                found.matchType = normalizeMatchType(body.matchType);
            }

            var fields = ["game","tournamentId","tournamentName","team1","team2",
                "scoreTeam1","scoreTeam2","score1","score2","winner","date","time",
                "status","roomId","roomPassword","result","notes"];
            for (var m = 0; m < fields.length; m++) {
                var f = fields[m];
                if (body[f] !== undefined && body[f] !== null) {
                    var af = f;
                    if (f === "score1") af = "scoreTeam1";
                    if (f === "score2") af = "scoreTeam2";
                    found[af] = cleanString(body[f]);
                }
            }

            if (Array.isArray(body.winners)) {
                var ws = body.winners.map(cleanString).filter(function (x) { return x !== ""; });
                found.winners = ws.slice(0, 3);
                if (!found.winner && found.winners.length > 0) {
                    found.winner = found.winners[0];
                }
            }

            found.updatedAt = nowISO();
            if (!writeJSON(MATCHES_FILE, matches)) {
                sendError(res, 500, "Could not update."); return;
            }
            sendJSON(res, 200, { success: true, message: "Match updated.", match: found });
        });
        return true;
    }

    /* DELETE MATCH */
    if (req.method === "DELETE" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return true;
        var mid = cleanString(query.get("id") || query.get("matchId"));
        if (!mid) { sendError(res, 400, "ID required."); return true; }
        var matches = getMatches();
        var rem = [], del = false;
        for (var i = 0; i < matches.length; i++) {
            if (String(matches[i].id) === String(mid)) { del = true; continue; }
            rem.push(matches[i]);
        }
        if (!del) { sendError(res, 404, "Not found."); return true; }
        if (!writeJSON(MATCHES_FILE, rem)) {
            sendError(res, 500, "Could not delete."); return true;
        }
        sendJSON(res, 200, { success: true, message: "Match deleted." });
        return true;
    }

    /* ADMIN ANNOUNCEMENTS LIST */
    if (req.method === "GET" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return true;
        var ann = getAnnouncements();
        ann.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        sendJSON(res, 200, { success: true, announcements: ann });
        return true;
    }

    /* CREATE ANNOUNCEMENT */
    if (req.method === "POST" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var title = cleanString(body.title);
            var message = cleanString(body.message);
            if (!title) { sendError(res, 400, "Title required."); return; }
            if (!message) { sendError(res, 400, "Message required."); return; }
            var ann = getAnnouncements();
            var item = {
                id: createId("ann"), title: title, message: message,
                type: cleanString(body.type) || "info",
                pinned: body.pinned === true || body.pinned === "true",
                createdAt: nowISO(), updatedAt: nowISO()
            };
            ann.push(item);
            if (!writeJSON(ANNOUNCEMENTS_FILE, ann)) {
                sendError(res, 500, "Could not save."); return;
            }
            sendJSON(res, 201, { success: true, message: "Created.", announcement: item });
        });
        return true;
    }

    /* UPDATE ANNOUNCEMENT */
    if (req.method === "PUT" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return true;
        readBody(req, function (err, body) {
            if (err) { sendError(res, 400, err.message); return; }
            var annId = cleanString(body.id || body.announcementId);
            if (!annId) { sendError(res, 400, "ID required."); return; }
            var ann = getAnnouncements();
            var found = null;
            for (var i = 0; i < ann.length; i++) {
                if (String(ann[i].id) === String(annId)) { found = ann[i]; break; }
            }
            if (!found) { sendError(res, 404, "Not found."); return; }
            if (body.title !== undefined) found.title = cleanString(body.title);
            if (body.message !== undefined) found.message = cleanString(body.message);
            if (body.type !== undefined) found.type = cleanString(body.type);
            if (body.pinned !== undefined) {
                found.pinned = body.pinned === true || body.pinned === "true";
            }
            found.updatedAt = nowISO();
            if (!writeJSON(ANNOUNCEMENTS_FILE, ann)) {
                sendError(res, 500, "Could not update."); return;
            }
            sendJSON(res, 200, { success: true, message: "Updated.", announcement: found });
        });
        return true;
    }

    /* DELETE ANNOUNCEMENT */
    if (req.method === "DELETE" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return true;
        var annId = cleanString(query.get("id") || query.get("announcementId"));
        if (!annId) { sendError(res, 400, "ID required."); return true; }
        var ann = getAnnouncements();
        var rem = [], del = false;
        for (var i = 0; i < ann.length; i++) {
            if (String(ann[i].id) === String(annId)) { del = true; continue; }
            rem.push(ann[i]);
        }
        if (!del) { sendError(res, 404, "Not found."); return true; }
        if (!writeJSON(ANNOUNCEMENTS_FILE, rem)) {
            sendError(res, 500, "Could not delete."); return true;
        }
        sendJSON(res, 200, { success: true, message: "Deleted." });
        return true;
    }

    /* PAYMENT SETTINGS */
    if (req.method === "GET" && pathname === "/api/payment-settings") {
        sendJSON(res, 200, { success: true, payment: PAYMENT_SETTINGS });
        return true;
    }

    /* CSV EXPORT */
    if (req.method === "GET" && pathname === "/api/admin/registrations.csv") {
        if (!requireAdmin(req, res)) return true;
        var regs = getRegistrations();
        var lines = [];
        lines.push(["ID","Username","Email","Tournament","Game","Team","Captain","Phone",
            "Player 1","Player 2","Player 3","Player 4","Player 5","Player 6",
            "Payment Method","Transaction ID","Amount","Payment Status",
            "Registration Status","Created At"].join(","));
        function csv(v) {
            var t = (v === undefined || v === null) ? "" : String(v);
            t = t.replace(/"/g, '""');
            return '"' + t + '"';
        }
        for (var c = 0; c < regs.length; c++) {
            var it = regs[c];
            lines.push([it.id,it.username,it.email,it.tournamentName,it.game,
                it.teamName,it.captainName,it.phone,
                it.player1,it.player2,it.player3,it.player4,it.player5,it.player6,
                it.paymentMethod,it.transactionId,it.amount,
                it.paymentStatus,it.status,it.createdAt].map(csv).join(","));
        }
        res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="nepplay-registrations.csv"'
        });
        res.end(lines.join("\r\n"));
        return true;
    }

    return false;
}

/* ============ HTTP SERVER ============ */

var server = http.createServer(function (req, res) {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        res.end(); return;
    }
    var parsed;
    try { parsed = new URL(req.url, "http://localhost:" + PORT); }
    catch (e) { sendError(res, 400, "Invalid URL."); return; }
    var pathname = parsed.pathname;
    var query = parsed.searchParams;
    if (pathname.indexOf("/api/") === 0) {
        var handled = handleAPI(req, res, pathname, query);
        if (handled) return;
        sendError(res, 404, "API route not found.");
        return;
    }
    serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, function () {
    console.log("");
    console.log("==================================================");
    console.log("              NEPPLAY SERVER STARTED");
    console.log("==================================================");
    console.log("Local: http://localhost:" + PORT);
    console.log("Admin: " + ADMIN_USERNAME + " / " + ADMIN_PASSWORD);
    console.log("eSewa: " + PAYMENT_SETTINGS.eSewa.number);
    console.log("Khalti: " + PAYMENT_SETTINGS.Khalti.number);
    console.log("==================================================");
    console.log("");
});

server.on("error", function (error) {
    console.log("");
    console.log("SERVER ERROR:", error.message);
    if (error.code === "EADDRINUSE") {
        console.log("Port 3000 is already in use.");
        console.log("Close the old Node server and run server.js again.");
    }
    console.log("");
});
