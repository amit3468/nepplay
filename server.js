"use strict";

/*
============================================================
                    NEPPLAY SERVER
============================================================
Run:  node server.js
Site: https://nepplay.onrender.com

Uses MongoDB Atlas
Includes: Player Profiles + Notifications
============================================================
*/

var http = require("http");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var URL = require("url").URL;
var MongoClient = require("mongodb").MongoClient;

var PORT = process.env.PORT || 3000;
var HOST = "0.0.0.0";
var BASE_DIR = __dirname;

var MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.log("");
    console.log("==================================================");
    console.log("ERROR: MONGODB_URI environment variable not set!");
    console.log("Set it in Render -> Environment tab");
    console.log("==================================================");
    console.log("");
    process.exit(1);
}

var DB_NAME = "nepplay";

var ADMIN_USERNAME = "admin";
var ADMIN_PASSWORD = "Npl@Amit2026!Ktm";

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

/* ============================================================
   MONGODB CONNECTION
============================================================ */

var db = null;
var collections = {};

function connectDB() {
    return MongoClient.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
    })
    .then(function (client) {
        console.log("Connected to MongoDB Atlas");
        db = client.db(DB_NAME);
        collections.users = db.collection("users");
        collections.registrations = db.collection("registrations");
        collections.matches = db.collection("matches");
        collections.tournaments = db.collection("tournaments");
        collections.announcements = db.collection("announcements");
        collections.notifications = db.collection("notifications");
        return createIndexes();
    })
    .then(function () {
        console.log("Indexes created");
        return seedTournaments();
    })
    .then(function () {
        console.log("Database ready");
    })
    .catch(function (err) {
        console.log("MongoDB connection error:", err.message);
        process.exit(1);
    });
}

function createIndexes() {
    return Promise.all([
        collections.users.createIndex({ username: 1 }, { unique: true }),
        collections.users.createIndex({ email: 1 }, { unique: true }),
        collections.registrations.createIndex({ userId: 1 }),
        collections.registrations.createIndex({ tournamentId: 1 }),
        collections.registrations.createIndex({ transactionId: 1 }),
        collections.matches.createIndex({ tournamentId: 1 }),
        collections.tournaments.createIndex({ id: 1 }, { unique: true }),
        collections.announcements.createIndex({ createdAt: -1 }),
        collections.notifications.createIndex({ userId: 1, createdAt: -1 })
    ]);
}

function seedTournaments() {
    return collections.tournaments.countDocuments().then(function (count) {
        if (count > 0) return;
        console.log("Seeding default tournaments...");
        return collections.tournaments.insertMany(DEFAULT_TOURNAMENTS);
    });
}

/* ============================================================
   HELPERS
============================================================ */

function createId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" +
        crypto.randomBytes(4).toString("hex");
}

function nowISO() { return new Date().toISOString(); }

function cleanString(v) {
    if (v === undefined || v === null) return "";
    return String(v).trim();
}

function safeNumber(v, f) {
    var n = Number(v);
    return isNaN(n) ? f : n;
}

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
    return {
        id: u.id || String(u._id || ""),
        username: u.username || "",
        email: u.email || "",
        createdAt: u.createdAt || ""
    };
}

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

function sendJSON(res, code, data, extra) {
    var h = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
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

/* ============================================================
   NOTIFICATIONS HELPER
============================================================ */

function createNotification(userId, type, title, message, link) {
    if (!userId) return Promise.resolve();
    return collections.notifications.insertOne({
        id: createId("notif"),
        userId: userId,
        type: type || "info",
        title: title || "",
        message: message || "",
        link: link || "",
        read: false,
        createdAt: nowISO()
    }).catch(function (e) {
        console.log("Notification error:", e.message);
    });
}

function createNotificationForTournament(tournamentId, type, title, message, link) {
    return collections.registrations.find({
        tournamentId: tournamentId,
        status: "Approved"
    }).toArray().then(function (regs) {
        var promises = regs.map(function (reg) {
            return createNotification(reg.userId, type, title, message, link);
        });
        return Promise.all(promises);
    }).catch(function (e) {
        console.log("Bulk notification error:", e.message);
    });
}

/* ============================================================
   AUTH HELPERS
============================================================ */

function requireMemberAsync(req, res) {
    var s = getSession(req);
    if (!s || s.role !== "member") {
        sendError(res, 401, "Please login first.");
        return Promise.resolve(null);
    }
    return collections.users.findOne({ id: s.userId })
        .then(function (u) {
            if (!u) { sendError(res, 401, "Please login first."); return null; }
            return u;
        })
        .catch(function () {
            sendError(res, 500, "Database error.");
            return null;
        });
}

function requireAdmin(req, res) {
    var s = getSession(req);
    if (!s || s.role !== "admin") {
        sendError(res, 401, "Admin login required.");
        return false;
    }
    return true;
}

/* ============================================================
   TOURNAMENT HELPERS
============================================================ */

function tournamentForClient(t, registeredCount) {
    var reg = registeredCount || 0;
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

function countTournamentRegistrations(tid) {
    return collections.registrations.countDocuments({
        tournamentId: tid,
        status: { $ne: "Rejected" }
    });
}

/* ============================================================
   LEADERBOARD + WINNERS
============================================================ */

function isCompletedMatch(m) {
    var s = String(m.status || "").toLowerCase().trim();
    return s === "completed" || s === "complete" ||
           s === "finished" || s === "finish";
}

function teamKey(n) {
    return String(n || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function buildLeaderboard(gameFilter) {
    return Promise.all([
        collections.matches.find({}).toArray(),
        collections.tournaments.find({}).toArray()
    ])
    .then(function (results) {
        var matches = results[0];
        var tournaments = results[1];

        var tGames = {};
        tournaments.forEach(function (t) {
            tGames[String(t.id || "")] = String(t.game || "");
        });

        var teamsByName = {};
        var counted = 0;
        var tSeen = {};

        function ensureTeam(name, captain, game) {
            var k = teamKey(name);
            if (!teamsByName[k]) {
                teamsByName[k] = {
                    name: name, captain: captain || "",
                    games: {}, played: 0, wins: 0, losses: 0,
                    ties: 0, points: 0,
                    brPlacements: { first: 0, second: 0, third: 0 }
                };
            }
            if (game) teamsByName[k].games[game] = true;
            return teamsByName[k];
        }

        matches.forEach(function (match) {
            if (!isCompletedMatch(match)) return;

            var g = cleanString(match.game) ||
                    tGames[String(match.tournamentId || "")] || "";

            if (gameFilter && gameFilter !== "all" &&
                g.toLowerCase() !== gameFilter.toLowerCase()) return;

            var matchType = normalizeMatchType(match.matchType);

            if (matchType === "battle-royale") {
                var winnersArr = Array.isArray(match.winners) ? match.winners : [];
                if (winnersArr.length === 0 && match.winner) winnersArr = [match.winner];
                if (winnersArr.length === 0) return;

                counted++;
                if (match.tournamentId) tSeen[String(match.tournamentId)] = true;

                winnersArr.forEach(function (teamName, wi) {
                    teamName = cleanString(teamName);
                    if (!teamName) return;
                    var team = ensureTeam(teamName, "", g);
                    team.played++;
                    if (wi === 0) { team.wins++; team.points += 3; team.brPlacements.first++; }
                    else if (wi === 1) { team.points += 2; team.brPlacements.second++; }
                    else if (wi === 2) { team.points += 1; team.brPlacements.third++; }
                });
                return;
            }

            var t1 = cleanString(match.team1);
            var t2 = cleanString(match.team2);
            if (!t1 || !t2) return;

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
        });

        var list = Object.keys(teamsByName).map(function (k) {
            var t = teamsByName[k];
            return {
                name: t.name, captain: t.captain,
                games: Object.keys(t.games),
                played: t.played, wins: t.wins,
                losses: t.losses, ties: t.ties,
                points: t.points,
                brPlacements: t.brPlacements
            };
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
    });
}

function buildWinners() {
    return Promise.all([
        collections.matches.find({}).toArray(),
        collections.tournaments.find({}).toArray(),
        collections.registrations.find({}).toArray()
    ])
    .then(function (results) {
        var matches = results[0];
        var tournaments = results[1];
        var regs = results[2];

        var winners = [];

        tournaments.forEach(function (tour) {
            var tid = String(tour.id || "");
            var completed = matches.filter(function (m) {
                if (String(m.tournamentId || "") !== tid) return false;
                if (!isCompletedMatch(m)) return false;
                var mt = normalizeMatchType(m.matchType);
                if (mt === "battle-royale") {
                    var wA = Array.isArray(m.winners) ? m.winners : [];
                    if (wA.length === 0 && m.winner) wA = [m.winner];
                    return wA.length > 0;
                }
                return !!m.winner;
            });

            if (completed.length === 0) return;

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
                if (ck !== teamKey(t1) && ck !== teamKey(t2)) return;
                runnerUp = (ck === teamKey(t1)) ? t2 : t1;
                champScore = cleanString(final.scoreTeam1);
                runScore = cleanString(final.scoreTeam2);
            }

            if (!champion) return;

            var cCapt = "", rCapt = "";
            regs.forEach(function (reg) {
                if (String(reg.tournamentId || "") !== tid) return;
                var rt = cleanString(reg.teamName);
                if (teamKey(rt) === teamKey(champion)) cCapt = cleanString(reg.captainName);
                if (teamKey(rt) === teamKey(runnerUp)) rCapt = cleanString(reg.captainName);
            });

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
        });

        winners.sort(function (a, b) {
            var da = (a.date || "") + "T" + (a.time || "00:00");
            var db = (b.date || "") + "T" + (b.time || "00:00");
            return new Date(db) - new Date(da);
        });

        return winners;
    });
}

/* ============================================================
   STATIC FILE SERVER
============================================================ */

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

/* ============================================================
   API ROUTES
============================================================ */

function handleAPI(req, res, pathname, query) {
    return handleAPIPromise(req, res, pathname, query).catch(function (err) {
        console.log("API error:", err.message);
        try { sendError(res, 500, "Server error: " + err.message); } catch (e) {}
        return true;
    });
}

function handleAPIPromise(req, res, pathname, query) {

    /* ============ USER REGISTER ============ */
    if (req.method === "POST" && pathname === "/api/users/register") {
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var username = cleanString(body.username);
                var email = cleanString(body.email).toLowerCase();
                var password = cleanString(body.password);

                if (!username) { sendError(res, 400, "Username is required."); return resolve(true); }
                if (!email) { sendError(res, 400, "Email is required."); return resolve(true); }
                if (!password) { sendError(res, 400, "Password is required."); return resolve(true); }
                if (password.length < 4) { sendError(res, 400, "Password min 4 chars."); return resolve(true); }

                collections.users.findOne({
                    $or: [{ username: username }, { email: email }]
                }).then(function (existing) {
                    if (existing) {
                        if (existing.username === username) sendError(res, 409, "Username already exists.");
                        else sendError(res, 409, "Email already exists.");
                        return resolve(true);
                    }
                    var pd = createPassword(password);
                    var user = {
                        id: createId("user"),
                        username: username,
                        email: email,
                        passwordHash: pd.passwordHash,
                        passwordSalt: pd.passwordSalt,
                        createdAt: nowISO()
                    };
                    return collections.users.insertOne(user)
                        .then(function () {
                            sendJSON(res, 201, {
                                success: true,
                                message: "Account created successfully.",
                                user: safeUser(user)
                            });
                            resolve(true);
                        });
                }).catch(function () {
                    sendError(res, 500, "Database error.");
                    resolve(true);
                });
            });
        });
    }

    /* ============ LOGIN ============ */
    if (req.method === "POST" &&
        (pathname === "/api/users/login" || pathname === "/api/member/login")) {
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var identifier = cleanString(body.login) || cleanString(body.username) ||
                    cleanString(body.email) || cleanString(body.userId);
                var password = cleanString(body.password);

                if (!identifier || !password) {
                    sendError(res, 400, "Username/email and password required.");
                    return resolve(true);
                }

                collections.users.findOne({
                    $or: [
                        { id: identifier },
                        { username: identifier },
                        { email: identifier.toLowerCase() }
                    ]
                }).then(function (found) {
                    if (!found) {
                        sendError(res, 401, "Invalid username/email or password.");
                        return resolve(true);
                    }
                    if (!verifyPassword(password, found)) {
                        sendError(res, 401, "Invalid username/email or password.");
                        return resolve(true);
                    }
                    var sid = createSession(found.id, "member");
                    var h = {};
                    setSessionCookie(h, sid);
                    sendJSON(res, 200, {
                        success: true,
                        message: "Login successful.",
                        user: safeUser(found)
                    }, h);
                    resolve(true);
                }).catch(function () {
                    sendError(res, 500, "Database error.");
                    resolve(true);
                });
            });
        });
    }

    /* ============ ME ============ */
    if (req.method === "GET" && pathname === "/api/users/me") {
        return requireMemberAsync(req, res).then(function (u) {
            if (!u) {
                sendJSON(res, 401, { success: false, loggedIn: false, user: null });
                return true;
            }
            sendJSON(res, 200, { success: true, loggedIn: true, user: safeUser(u) });
            return true;
        });
    }

    /* ============ LOGOUT ============ */
    if (req.method === "POST" && pathname === "/api/users/logout") {
        var c = parseCookies(req);
        if (c[SESSION_COOKIE]) sessions.delete(c[SESSION_COOKIE]);
        var h = {};
        clearSessionCookie(h);
        sendJSON(res, 200, { success: true, message: "Logged out." }, h);
        return Promise.resolve(true);
    }

    /* ============ MY REGISTRATIONS ============ */
    if (req.method === "GET" && pathname === "/api/users/registrations") {
        return requireMemberAsync(req, res).then(function (u) {
            if (!u) return true;
            return collections.registrations.find({ userId: u.id }).toArray()
                .then(function (regs) {
                    sendJSON(res, 200, {
                        success: true,
                        registrations: regs.map(registrationForClient)
                    });
                    return true;
                });
        });
    }

    /* ============ PUBLIC TOURNAMENTS ============ */
    if (req.method === "GET" && pathname === "/api/tournaments") {
        return collections.tournaments.find({}).toArray()
            .then(function (tournaments) {
                return Promise.all(tournaments.map(function (t) {
                    return countTournamentRegistrations(t.id)
                        .then(function (cnt) { return tournamentForClient(t, cnt); });
                }));
            })
            .then(function (list) {
                sendJSON(res, 200, { success: true, tournaments: list });
                return true;
            });
    }

    /* ============ SINGLE TOURNAMENT ============ */
    if (req.method === "GET" && pathname === "/api/tournaments/one") {
        var key = query.get("id") || query.get("tournamentId") || query.get("tournament");
        return collections.tournaments.findOne({
            $or: [{ id: key }, { name: key }]
        }).then(function (t) {
            if (!t) { sendError(res, 404, "Tournament not found."); return true; }
            return countTournamentRegistrations(t.id).then(function (cnt) {
                sendJSON(res, 200, {
                    success: true,
                    tournament: tournamentForClient(t, cnt)
                });
                return true;
            });
        });
    }

    /* ============ ADMIN CREATE TOURNAMENT ============ */
    if (req.method === "POST" && pathname === "/api/tournaments") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var name = cleanString(body.name);
                if (!name) { sendError(res, 400, "Tournament name required."); return resolve(true); }

                var nt = {
                    id: createId("tour"),
                    name: name,
                    game: cleanString(body.game) || "Free Fire",
                    date: cleanString(body.date),
                    time: cleanString(body.time),
                    entryFee: safeNumber(body.entryFee, 0),
                    teamSize: safeNumber(body.teamSize, 4),
                    maxTeams: safeNumber(body.maxTeams, 16),
                    prizePool: safeNumber(body.prizePool, 0),
                    status: cleanString(body.status) || "Upcoming",
                    createdAt: nowISO()
                };
                collections.tournaments.insertOne(nt)
                    .then(function () {
                        sendJSON(res, 201, {
                            success: true,
                            message: "Tournament created.",
                            tournament: nt
                        });
                        resolve(true);
                    })
                    .catch(function () {
                        sendError(res, 500, "Could not save.");
                        resolve(true);
                    });
            });
        });
    }

    /* ============ UPDATE TOURNAMENT ============ */
    if (req.method === "PUT" && pathname.indexOf("/api/tournaments/") === 0 &&
        pathname.indexOf("/api/tournaments/one") !== 0) {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        var upId = decodeURIComponent(pathname.replace("/api/tournaments/", ""));
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var updates = {};
                ["name","game","date","time","status"].forEach(function (k) {
                    if (body[k] !== undefined && body[k] !== null) updates[k] = cleanString(body[k]);
                });
                if (body.entryFee !== undefined) updates.entryFee = safeNumber(body.entryFee, 0);
                if (body.teamSize !== undefined) updates.teamSize = safeNumber(body.teamSize, 4);
                if (body.maxTeams !== undefined) updates.maxTeams = safeNumber(body.maxTeams, 16);
                if (body.prizePool !== undefined) updates.prizePool = safeNumber(body.prizePool, 0);
                updates.updatedAt = nowISO();

                collections.tournaments.findOneAndUpdate(
                    { id: upId },
                    { $set: updates },
                    { returnDocument: "after" }
                ).then(function (result) {
                    if (!result || !result.value) {
                        sendError(res, 404, "Not found.");
                        return resolve(true);
                    }
                    sendJSON(res, 200, {
                        success: true,
                        message: "Tournament updated.",
                        tournament: result.value
                    });
                    resolve(true);
                });
            });
        });
    }

    /* ============ DELETE TOURNAMENT ============ */
    if (req.method === "DELETE" && pathname.indexOf("/api/tournaments/") === 0) {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        var delId = decodeURIComponent(pathname.replace("/api/tournaments/", ""));
        return collections.tournaments.deleteOne({ id: delId })
            .then(function (result) {
                if (result.deletedCount === 0) {
                    sendError(res, 404, "Not found.");
                    return true;
                }
                sendJSON(res, 200, { success: true, message: "Deleted." });
                return true;
            });
    }

    /* ============ CREATE REGISTRATION ============ */
    if (req.method === "POST" && pathname === "/api/registrations") {
        return requireMemberAsync(req, res).then(function (user) {
            if (!user) return true;
            return new Promise(function (resolve) {
                readBody(req, function (err, body) {
                    if (err) { sendError(res, 400, err.message); return resolve(true); }
                    var tid = cleanString(body.tournamentId || body.tournament);

                    collections.tournaments.findOne({ id: tid }).then(function (tour) {
                        if (!tour) { sendError(res, 404, "Tournament not found."); return resolve(true); }
                        var ts = cleanString(tour.status).toLowerCase();
                        if (ts === "closed" || ts === "completed") {
                            sendError(res, 400, "Tournament is closed.");
                            return resolve(true);
                        }
                        return countTournamentRegistrations(tour.id).then(function (cnt) {
                            var max = safeNumber(tour.maxTeams, 0);
                            if (max > 0 && cnt >= max) {
                                sendError(res, 400, "Tournament is full.");
                                return resolve(true);
                            }

                            var pm = cleanString(body.paymentMethod ||
                                (body.payment && body.payment.method));
                            var txId = cleanString(body.transactionId ||
                                (body.payment && body.payment.transactionId));
                            var fee = safeNumber(tour.entryFee, 0);

                            if (fee > 0) {
                                if (pm !== "Khalti" && pm !== "eSewa") {
                                    sendError(res, 400, "Select Khalti or eSewa.");
                                    return resolve(true);
                                }
                                if (txId.length < 3 || txId.length > 100) {
                                    sendError(res, 400, "Invalid transaction ID.");
                                    return resolve(true);
                                }
                            } else if (!pm) {
                                pm = "Free";
                            }

                            return collections.registrations.findOne({
                                transactionId: txId
                            }).then(function (existing) {
                                if (txId && existing) {
                                    sendError(res, 409, "Transaction ID already used.");
                                    return resolve(true);
                                }

                                var reg = {
                                    id: createId("reg"),
                                    userId: user.id,
                                    username: user.username,
                                    email: user.email,
                                    tournamentId: tour.id,
                                    tournamentName: tour.name,
                                    game: tour.game,
                                    teamName: cleanString(body.teamName),
                                    captainName: cleanString(body.captainName || body.captain),
                                    phone: cleanString(body.phone),
                                    player1: cleanString(body.player1),
                                    player2: cleanString(body.player2),
                                    player3: cleanString(body.player3),
                                    player4: cleanString(body.player4),
                                    player5: cleanString(body.player5),
                                    player6: cleanString(body.player6),
                                    payerName: cleanString(body.payerName),
                                    payerPhone: cleanString(body.payerPhone),
                                    paymentMethod: pm,
                                    transactionId: txId,
                                    amount: fee,
                                    paymentStatus: fee > 0 ? "Pending" : "Not Required",
                                    status: "Pending",
                                    message: cleanString(body.message),
                                    createdAt: nowISO(),
                                    updatedAt: nowISO()
                                };

                                if (!reg.teamName) { sendError(res, 400, "Team name required."); return resolve(true); }
                                if (!reg.captainName) { sendError(res, 400, "Captain name required."); return resolve(true); }

                                return collections.registrations.insertOne(reg)
                                    .then(function () {
                                        return createNotification(
                                            user.id,
                                            "info",
                                            "Registration submitted",
                                            "Your registration for " + tour.name + " is pending admin approval.",
                                            "member.html"
                                        );
                                    })
                                    .then(function () {
                                        sendJSON(res, 201, {
                                            success: true,
                                            message: "Registration submitted.",
                                            registration: registrationForClient(reg)
                                        });
                                        resolve(true);
                                    });
                            });
                        });
                    }).catch(function (e) {
                        console.log("Reg error:", e.message);
                        sendError(res, 500, "Database error.");
                        resolve(true);
                    });
                });
            });
        });
    }

    /* ============ PUBLIC REGISTRATIONS ============ */
    if (req.method === "GET" && pathname === "/api/registrations") {
        return collections.registrations.find({ status: { $ne: "Rejected" } })
            .toArray()
            .then(function (regs) {
                sendJSON(res, 200, {
                    success: true,
                    registrations: regs.map(registrationForClient)
                });
                return true;
            });
    }

    /* ============ PUBLIC MATCHES ============ */
    if (req.method === "GET" && pathname === "/api/matches") {
        return collections.matches.find({}).toArray()
            .then(function (matches) {
                sendJSON(res, 200, { success: true, matches: matches });
                return true;
            });
    }

    /* ============ MEMBER MATCHES ============ */
    if (req.method === "GET" && pathname === "/api/member/matches") {
        return requireMemberAsync(req, res).then(function (mem) {
            if (!mem) return true;
            return collections.registrations.find({
                userId: mem.id,
                status: "Approved"
            }).toArray()
            .then(function (regs) {
                var myTids = {};
                regs.forEach(function (r) { myTids[String(r.tournamentId || "")] = true; });

                return Promise.all([
                    collections.matches.find({}).toArray(),
                    collections.tournaments.find({}).toArray()
                ]).then(function (results) {
                    var matches = results[0];
                    var tours = results[1];

                    var tMap = {};
                    tours.forEach(function (t) { tMap[String(t.id || "")] = t; });

                    var out = [];
                    matches.forEach(function (mm) {
                        var tid = String(mm.tournamentId || "");
                        if (!myTids[tid]) return;

                        var t = tMap[tid] || {};
                        var em = {};
                        Object.keys(mm).forEach(function (k) { em[k] = mm[k]; });

                        em.matchType = normalizeMatchType(mm.matchType);
                        em.tournament = {
                            id: t.id || "",
                            name: t.name || mm.tournamentName || "",
                            game: t.game || mm.game || "",
                            date: t.date || "",
                            time: t.time || "",
                            entryFee: t.entryFee || 0,
                            prizePool: t.prizePool || 0,
                            teamSize: t.teamSize || 0
                        };

                        var joined = Array.isArray(mm.joinedUserIds) ? mm.joinedUserIds : [];
                        em.memberJoined = joined.indexOf(mem.id) !== -1;

                        out.push(em);
                    });

                    out.sort(function (a, b) {
                        var da = (a.date || "") + "T" + (a.time || "00:00");
                        var db = (b.date || "") + "T" + (b.time || "00:00");
                        return new Date(da) - new Date(db);
                    });

                    sendJSON(res, 200, { success: true, matches: out });
                    return true;
                });
            });
        });
    }

    /* ============ MEMBER JOINS MATCH ============ */
    if (req.method === "POST" && pathname === "/api/member/join-match") {
        return requireMemberAsync(req, res).then(function (jUser) {
            if (!jUser) return true;
            return new Promise(function (resolve) {
                readBody(req, function (err, body) {
                    if (err) { sendError(res, 400, err.message); return resolve(true); }
                    var mid = cleanString(body.matchId || body.id);
                    if (!mid) { sendError(res, 400, "Match ID required."); return resolve(true); }

                    collections.matches.updateOne(
                        { id: mid },
                        { $addToSet: { joinedUserIds: jUser.id },
                          $set: { updatedAt: nowISO() } }
                    ).then(function (result) {
                        if (result.matchedCount === 0) {
                            sendError(res, 404, "Match not found.");
                            return resolve(true);
                        }
                        sendJSON(res, 200, { success: true, message: "Joined!", joined: true });
                        resolve(true);
                    }).catch(function () {
                        sendError(res, 500, "Could not save.");
                        resolve(true);
                    });
                });
            });
        });
    }

    /* ============ PLAYER PROFILE (D1) ============ */
    if (req.method === "GET" && pathname === "/api/player") {
        var username = cleanString(query.get("username"));
        if (!username) {
            sendError(res, 400, "Username required.");
            return Promise.resolve(true);
        }
        var usernameLower = username.toLowerCase();

        return Promise.all([
            collections.users.findOne({ username: username }),
            collections.registrations.find({}).toArray(),
            collections.matches.find({}).toArray(),
            collections.tournaments.find({}).toArray()
        ]).then(function (results) {
            var user = results[0];
            var registrations = results[1];
            var matches = results[2];
            var tournaments = results[3];

            var userRegs = registrations.filter(function (r) {
                if (!r.captainName) return false;
                return String(r.captainName).toLowerCase() === usernameLower;
            });

            var teamNames = {};
            userRegs.forEach(function (r) {
                if (r.teamName) teamNames[String(r.teamName).toLowerCase()] = r.teamName;
            });

            var teamKeys = Object.keys(teamNames);
            var playerMatches = [];
            var wins = 0, losses = 0, ties = 0;

            matches.forEach(function (m) {
                var matchType = normalizeMatchType(m.matchType);
                var involved = false;
                var result = "";

                if (matchType === "battle-royale") {
                    var winners = Array.isArray(m.winners) ? m.winners : [];
                    if (m.winner && winners.length === 0) winners = [m.winner];
                    for (var i = 0; i < teamKeys.length; i++) {
                        var tn = teamNames[teamKeys[i]];
                        if (winners.indexOf(tn) !== -1) {
                            involved = true;
                            result = (i === 0) ? "WIN" : "TOP 3";
                            break;
                        }
                    }
                } else {
                    var t1 = String(m.team1 || "").toLowerCase();
                    var t2 = String(m.team2 || "").toLowerCase();
                    for (var j = 0; j < teamKeys.length; j++) {
                        if (t1 === teamKeys[j] || t2 === teamKeys[j]) {
                            involved = true;
                            var w = String(m.winner || "").toLowerCase();
                            if (!w) result = "TIE";
                            else if (w === teamKeys[j]) result = "WIN";
                            else result = "LOSS";
                            break;
                        }
                    }
                }

                if (!involved) return;
                if (!isCompletedMatch(m)) return;

                if (result === "WIN") wins++;
                else if (result === "LOSS") losses++;
                else if (result === "TIE") ties++;

                playerMatches.push({
                    id: m.id,
                    name: m.result || m.name || "Match",
                    tournament: m.tournamentName || "",
                    game: m.game || "",
                    date: m.date || "",
                    result: result,
                    matchType: matchType,
                    team1: m.team1 || "",
                    team2: m.team2 || "",
                    winner: m.winner || (m.winners && m.winners[0]) || ""
                });
            });

            playerMatches.sort(function (a, b) {
                return new Date(b.date || "1970-01-01") - new Date(a.date || "1970-01-01");
            });

            var points = wins * 3 + ties * 1;
            var total = wins + losses + ties;
            var winRate = total > 0 ? Math.round(wins / total * 100) : 0;

            var championships = [];
            tournaments.forEach(function (tour) {
                var tid = String(tour.id || "");
                var completed = matches.filter(function (m) {
                    if (String(m.tournamentId || "") !== tid) return false;
                    if (!isCompletedMatch(m)) return false;
                    var mt = normalizeMatchType(m.matchType);
                    if (mt === "battle-royale") {
                        var wA = Array.isArray(m.winners) ? m.winners : [];
                        if (wA.length === 0 && m.winner) wA = [m.winner];
                        return wA.length > 0;
                    }
                    return !!m.winner;
                });
                if (completed.length === 0) return;

                completed.sort(function (a, b) {
                    var da = (a.date || "") + "T" + (a.time || "00:00");
                    var db = (b.date || "") + "T" + (b.time || "00:00");
                    return new Date(da) - new Date(db);
                });

                var final = completed[completed.length - 1];
                var mt = normalizeMatchType(final.matchType);
                var champion = "";

                if (mt === "battle-royale") {
                    var wA = Array.isArray(final.winners) ? final.winners : [];
                    if (wA.length === 0 && final.winner) wA = [final.winner];
                    champion = String(wA[0] || "").toLowerCase();
                } else {
                    champion = String(final.winner || "").toLowerCase();
                }

                if (teamKeys.indexOf(champion) !== -1) {
                    championships.push({
                        tournamentId: tour.id,
                        tournamentName: tour.name || "Tournament",
                        game: tour.game || "",
                        date: tour.date || "",
                        prizePool: tour.prizePool || 0
                    });
                }
            });

            var teamsList = Object.keys(teamNames).map(function (k) { return teamNames[k]; });

            sendJSON(res, 200, {
                success: true,
                player: {
                    username: username,
                    memberSince: user ? user.createdAt : "",
                    exists: !!user,
                    teams: teamsList,
                    stats: {
                        matchesPlayed: total,
                        wins: wins,
                        losses: losses,
                        ties: ties,
                        winRate: winRate,
                        points: points,
                        championships: championships.length,
                        tournamentsEntered: userRegs.length
                    },
                    championships: championships,
                    matchHistory: playerMatches.slice(0, 20)
                }
            });
            return true;
        }).catch(function (err) {
            console.log("Player error:", err.message);
            sendError(res, 500, "Could not load player profile.");
            return true;
        });
    }

    /* ============ LEADERBOARD ============ */
    if (req.method === "GET" && pathname === "/api/leaderboard") {
        var gf = query.get("game") || "all";
        return buildLeaderboard(gf).then(function (r) {
            sendJSON(res, 200, {
                success: true,
                teams: r.teams,
                totalTeams: r.totalTeams,
                totalMatches: r.totalMatches,
                totalTournaments: r.totalTournaments,
                filter: gf
            });
            return true;
        });
    }

    /* ============ WINNERS ============ */
    if (req.method === "GET" && pathname === "/api/winners") {
        return buildWinners().then(function (w) {
            sendJSON(res, 200, {
                success: true,
                winners: w,
                totalTournaments: w.length
            });
            return true;
        });
    }

    /* ============ PUBLIC ANNOUNCEMENTS ============ */
    if (req.method === "GET" && pathname === "/api/announcements") {
        return collections.announcements.find({})
            .sort({ createdAt: -1 })
            .toArray()
            .then(function (ann) {
                var lim = query.get("limit");
                if (lim) {
                    var ln = safeNumber(lim, 0);
                    if (ln > 0) ann = ann.slice(0, ln);
                }
                sendJSON(res, 200, { success: true, announcements: ann });
                return true;
            });
    }

    /* ============ NOTIFICATIONS (D3) ============ */
    if (req.method === "GET" && pathname === "/api/notifications") {
        return requireMemberAsync(req, res).then(function (mem) {
            if (!mem) return true;
            return collections.notifications
                .find({ userId: mem.id })
                .sort({ createdAt: -1 })
                .limit(50)
                .toArray()
                .then(function (list) {
                    var unread = 0;
                    list.forEach(function (n) { if (!n.read) unread++; });
                    sendJSON(res, 200, {
                        success: true,
                        notifications: list,
                        unread: unread
                    });
                    return true;
                });
        });
    }

    if (req.method === "POST" && pathname === "/api/notifications/read") {
        return requireMemberAsync(req, res).then(function (mem) {
            if (!mem) return true;
            return new Promise(function (resolve) {
                readBody(req, function (err, body) {
                    if (err) { sendError(res, 400, err.message); return resolve(true); }
                    var notifId = cleanString(body.id);

                    if (notifId) {
                        collections.notifications.updateOne(
                            { id: notifId, userId: mem.id },
                            { $set: { read: true, readAt: nowISO() } }
                        ).then(function () {
                            sendJSON(res, 200, { success: true });
                            resolve(true);
                        }).catch(function () {
                            sendError(res, 500, "Could not save.");
                            resolve(true);
                        });
                    } else {
                        collections.notifications.updateMany(
                            { userId: mem.id, read: false },
                            { $set: { read: true, readAt: nowISO() } }
                        ).then(function () {
                            sendJSON(res, 200, { success: true });
                            resolve(true);
                        }).catch(function () {
                            sendError(res, 500, "Could not save.");
                            resolve(true);
                        });
                    }
                });
            });
        });
    }

    /* ============ ADMIN LOGIN ============ */
    if (req.method === "POST" && pathname === "/api/admin/login") {
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var u = cleanString(body.username);
                var p = cleanString(body.password);
                if (u !== ADMIN_USERNAME || p !== ADMIN_PASSWORD) {
                    sendError(res, 401, "Invalid admin credentials.");
                    return resolve(true);
                }
                var sid = createSession("admin", "admin");
                var h = {};
                setSessionCookie(h, sid);
                sendJSON(res, 200, {
                    success: true,
                    message: "Admin login successful.",
                    admin: { username: ADMIN_USERNAME }
                }, h);
                resolve(true);
            });
        });
    }

    /* ============ ADMIN CHECK ============ */
    if (req.method === "GET" && pathname === "/api/admin/check") {
        var s = getSession(req);
        if (!s || s.role !== "admin") {
            sendJSON(res, 401, { success: false, loggedIn: false });
            return Promise.resolve(true);
        }
        sendJSON(res, 200, {
            success: true,
            loggedIn: true,
            admin: { username: ADMIN_USERNAME }
        });
        return Promise.resolve(true);
    }

    /* ============ ADMIN LOGOUT ============ */
    if (req.method === "POST" && pathname === "/api/admin/logout") {
        var c = parseCookies(req);
        if (c[SESSION_COOKIE]) sessions.delete(c[SESSION_COOKIE]);
        var h = {};
        clearSessionCookie(h);
        sendJSON(res, 200, { success: true, message: "Admin logged out." }, h);
        return Promise.resolve(true);
    }

    /* ============ ADMIN REGISTRATIONS ============ */
    if (req.method === "GET" && pathname === "/api/admin/registrations") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return collections.registrations.find({}).toArray()
            .then(function (regs) {
                sendJSON(res, 200, {
                    success: true,
                    registrations: regs.map(registrationForClient)
                });
                return true;
            });
    }

    /* ============ ADMIN REG STATUS (body) ============ */
    if (req.method === "PUT" && pathname === "/api/admin/registrations/status") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var rid = cleanString(body.registrationId || body.id);
                var st = normalizeStatus(body.status);
                if (!rid) { sendError(res, 400, "ID required."); return resolve(true); }
                if (st !== "Pending" && st !== "Approved" && st !== "Rejected") {
                    sendError(res, 400, "Invalid status."); return resolve(true);
                }

                var updates = { status: st, updatedAt: nowISO() };
                if (st === "Approved") updates.paymentStatus = "Verified";
                if (st === "Rejected") updates.paymentStatus = "Rejected";

                collections.registrations.findOneAndUpdate(
                    { id: rid },
                    { $set: updates },
                    { returnDocument: "after" }
                ).then(function (result) {
                    if (!result || !result.value) {
                        sendError(res, 404, "Not found.");
                        return resolve(true);
                    }
                    var reg = result.value;

                    var notifPromise = Promise.resolve();
                    if (st === "Approved") {
                        notifPromise = createNotification(
                            reg.userId,
                            "success",
                            "Registration Approved",
                            "Your team " + reg.teamName + " is approved for " + reg.tournamentName + ".",
                            "member.html"
                        );
                    } else if (st === "Rejected") {
                        notifPromise = createNotification(
                            reg.userId,
                            "error",
                            "Registration Rejected",
                            "Your registration for " + reg.tournamentName + " was rejected.",
                            "member.html"
                        );
                    }

                    return notifPromise.then(function () {
                        sendJSON(res, 200, {
                            success: true,
                            message: "Status updated.",
                            registration: registrationForClient(reg)
                        });
                        resolve(true);
                    });
                });
            });
        });
    }

    /* ============ ADMIN REG STATUS (URL) ============ */
    if (req.method === "PUT" && pathname.indexOf("/api/admin/registrations/") === 0 &&
        pathname.indexOf("/status") !== -1) {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        var raw = pathname.replace("/api/admin/registrations/", "");
        var rid = decodeURIComponent(raw.replace(/\/status$/, ""));
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var st = normalizeStatus(body.status);
                if (st !== "Pending" && st !== "Approved" && st !== "Rejected") {
                    sendError(res, 400, "Invalid status."); return resolve(true);
                }
                var updates = { status: st, updatedAt: nowISO() };
                if (st === "Approved") updates.paymentStatus = "Verified";
                if (st === "Rejected") updates.paymentStatus = "Rejected";

                collections.registrations.findOneAndUpdate(
                    { id: rid },
                    { $set: updates },
                    { returnDocument: "after" }
                ).then(function (result) {
                    if (!result || !result.value) {
                        sendError(res, 404, "Not found.");
                        return resolve(true);
                    }
                    var reg = result.value;

                    var notifPromise = Promise.resolve();
                    if (st === "Approved") {
                        notifPromise = createNotification(
                            reg.userId,
                            "success",
                            "Registration Approved",
                            "Your team " + reg.teamName + " is approved for " + reg.tournamentName + ".",
                            "member.html"
                        );
                    } else if (st === "Rejected") {
                        notifPromise = createNotification(
                            reg.userId,
                            "error",
                            "Registration Rejected",
                            "Your registration for " + reg.tournamentName + " was rejected.",
                            "member.html"
                        );
                    }

                    return notifPromise.then(function () {
                        sendJSON(res, 200, {
                            success: true,
                            message: "Status updated.",
                            registration: registrationForClient(reg)
                        });
                        resolve(true);
                    });
                });
            });
        });
    }

    /* ============ ADMIN REG EDIT ============ */
    if (req.method === "PUT" && pathname === "/api/admin/registrations") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var rid = cleanString(body.id || body.registrationId);
                if (!rid) { sendError(res, 400, "ID required."); return resolve(true); }

                var updates = {};
                ["teamName","captainName","phone","player1","player2","player3",
                    "player4","player5","player6","payerName","payerPhone","paymentMethod",
                    "transactionId","message","status","paymentStatus"].forEach(function (f) {
                    if (body[f] !== undefined && body[f] !== null) updates[f] = cleanString(body[f]);
                });
                updates.updatedAt = nowISO();

                collections.registrations.findOneAndUpdate(
                    { id: rid },
                    { $set: updates },
                    { returnDocument: "after" }
                ).then(function (result) {
                    if (!result || !result.value) {
                        sendError(res, 404, "Not found.");
                        return resolve(true);
                    }
                    sendJSON(res, 200, {
                        success: true,
                        message: "Updated.",
                        registration: registrationForClient(result.value)
                    });
                    resolve(true);
                });
            });
        });
    }

    /* ============ ADMIN REG DELETE ============ */
    if (req.method === "DELETE" && pathname === "/api/admin/registrations") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        var rid = cleanString(query.get("id") || query.get("registrationId"));
        if (!rid) { sendError(res, 400, "ID required."); return Promise.resolve(true); }
        return collections.registrations.deleteOne({ id: rid })
            .then(function (result) {
                if (result.deletedCount === 0) {
                    sendError(res, 404, "Not found.");
                    return true;
                }
                sendJSON(res, 200, { success: true, message: "Deleted." });
                return true;
            });
    }

    /* ============ ADMIN TOURNAMENTS LIST ============ */
    if (req.method === "GET" && pathname === "/api/admin/tournaments") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return collections.tournaments.find({}).toArray()
            .then(function (tournaments) {
                return Promise.all(tournaments.map(function (t) {
                    return countTournamentRegistrations(t.id)
                        .then(function (cnt) { return tournamentForClient(t, cnt); });
                }));
            })
            .then(function (list) {
                sendJSON(res, 200, { success: true, tournaments: list });
                return true;
            });
    }

    /* ============ ADMIN MATCHES LIST ============ */
    if (req.method === "GET" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return collections.matches.find({}).toArray()
            .then(function (matches) {
                sendJSON(res, 200, { success: true, matches: matches });
                return true;
            });
    }

    /* ============ CREATE MATCH ============ */
    if (req.method === "POST" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var matchType = normalizeMatchType(body.matchType);
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
                collections.matches.insertOne(match)
                    .then(function () {
                        /* Notify all approved members of this tournament */
                        return createNotificationForTournament(
                            match.tournamentId,
                            "info",
                            "New Match Scheduled",
                            match.result + " for " + match.tournamentName + " on " + match.date + " at " + match.time,
                            "member.html"
                        );
                    })
                    .then(function () {
                        sendJSON(res, 201, {
                            success: true,
                            message: "Match created.",
                            match: match
                        });
                        resolve(true);
                    })
                    .catch(function () {
                        sendError(res, 500, "Could not save.");
                        resolve(true);
                    });
            });
        });
    }

    /* ============ UPDATE MATCH ============ */
    if (req.method === "PUT" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var mid = cleanString(body.id || body.matchId);
                if (!mid) { sendError(res, 400, "ID required."); return resolve(true); }

                /* Get old match first to detect status changes */
                collections.matches.findOne({ id: mid }).then(function (oldMatch) {
                    if (!oldMatch) {
                        sendError(res, 404, "Not found.");
                        return resolve(true);
                    }

                    var updates = {};
                    if (body.matchType !== undefined) {
                        updates.matchType = normalizeMatchType(body.matchType);
                    }
                    ["game","tournamentId","tournamentName","team1","team2",
                        "scoreTeam1","scoreTeam2","winner","date","time",
                        "status","roomId","roomPassword","result","notes"].forEach(function (f) {
                        if (body[f] !== undefined && body[f] !== null) {
                            updates[f] = cleanString(body[f]);
                        }
                    });
                    if (body.score1 !== undefined) updates.scoreTeam1 = cleanString(body.score1);
                    if (body.score2 !== undefined) updates.scoreTeam2 = cleanString(body.score2);
                    if (Array.isArray(body.winners)) {
                        var ws = body.winners.map(cleanString).filter(function (x) { return x !== ""; });
                        updates.winners = ws.slice(0, 3);
                        if (!updates.winner && ws.length > 0) updates.winner = ws[0];
                    }
                    updates.updatedAt = nowISO();

                    return collections.matches.findOneAndUpdate(
                        { id: mid },
                        { $set: updates },
                        { returnDocument: "after" }
                    ).then(function (result) {
                        if (!result || !result.value) {
                            sendError(res, 404, "Not found.");
                            return resolve(true);
                        }

                        var oldStatus = String(oldMatch.status || "").toLowerCase();
                        var newStatus = String(result.value.status || "").toLowerCase();

                        var notifPromises = [];

                        /* Notify when Room ID is published (status changes to Live) */
                        if (newStatus === "live" && oldStatus !== "live" &&
                            result.value.roomId) {
                            notifPromises.push(createNotificationForTournament(
                                result.value.tournamentId,
                                "urgent",
                                "Room ID Released!",
                                result.value.result + " is live now. Room ID: " + result.value.roomId +
                                (result.value.roomPassword ? " Password: " + result.value.roomPassword : ""),
                                "member.html"
                            ));
                        }

                        /* Notify when match is completed */
                        if ((newStatus === "completed" || newStatus === "finished") &&
                            oldStatus !== "completed" && oldStatus !== "finished") {
                            notifPromises.push(createNotificationForTournament(
                                result.value.tournamentId,
                                "success",
                                "Match Completed",
                                result.value.result + " has finished. Winner: " +
                                (result.value.winner || (result.value.winners && result.value.winners[0]) || "TBD"),
                                "member.html"
                            ));
                        }

                        return Promise.all(notifPromises).then(function () {
                            sendJSON(res, 200, {
                                success: true,
                                message: "Match updated.",
                                match: result.value
                            });
                            resolve(true);
                        });
                    });
                }).catch(function (e) {
                    console.log("Update match error:", e.message);
                    sendError(res, 500, "Could not update.");
                    resolve(true);
                });
            });
        });
    }

    /* ============ DELETE MATCH ============ */
    if (req.method === "DELETE" && pathname === "/api/admin/matches") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        var mid = cleanString(query.get("id") || query.get("matchId"));
        if (!mid) { sendError(res, 400, "ID required."); return Promise.resolve(true); }
        return collections.matches.deleteOne({ id: mid })
            .then(function (result) {
                if (result.deletedCount === 0) {
                    sendError(res, 404, "Not found.");
                    return true;
                }
                sendJSON(res, 200, { success: true, message: "Match deleted." });
                return true;
            });
    }

    /* ============ ADMIN ANNOUNCEMENTS LIST ============ */
    if (req.method === "GET" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return collections.announcements.find({}).sort({ createdAt: -1 }).toArray()
            .then(function (ann) {
                sendJSON(res, 200, { success: true, announcements: ann });
                return true;
            });
    }

    /* ============ CREATE ANNOUNCEMENT ============ */
    if (req.method === "POST" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var title = cleanString(body.title);
                var message = cleanString(body.message);
                if (!title) { sendError(res, 400, "Title required."); return resolve(true); }
                if (!message) { sendError(res, 400, "Message required."); return resolve(true); }

                var item = {
                    id: createId("ann"),
                    title: title,
                    message: message,
                    type: cleanString(body.type) || "info",
                    pinned: body.pinned === true || body.pinned === "true",
                    createdAt: nowISO(),
                    updatedAt: nowISO()
                };
                collections.announcements.insertOne(item)
                    .then(function () {
                        /* Notify all users */
                        return collections.users.find({}).toArray()
                            .then(function (users) {
                                var promises = users.map(function (u) {
                                    return createNotification(
                                        u.id,
                                        item.type === "urgent" ? "error" : "info",
                                        "Announcement: " + item.title,
                                        item.message,
                                        "index.html"
                                    );
                                });
                                return Promise.all(promises);
                            });
                    })
                    .then(function () {
                        sendJSON(res, 201, {
                            success: true,
                            message: "Created.",
                            announcement: item
                        });
                        resolve(true);
                    })
                    .catch(function () {
                        sendError(res, 500, "Could not save.");
                        resolve(true);
                    });
            });
        });
    }

    /* ============ UPDATE ANNOUNCEMENT ============ */
    if (req.method === "PUT" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return new Promise(function (resolve) {
            readBody(req, function (err, body) {
                if (err) { sendError(res, 400, err.message); return resolve(true); }
                var annId = cleanString(body.id || body.announcementId);
                if (!annId) { sendError(res, 400, "ID required."); return resolve(true); }

                var updates = {};
                if (body.title !== undefined) updates.title = cleanString(body.title);
                if (body.message !== undefined) updates.message = cleanString(body.message);
                if (body.type !== undefined) updates.type = cleanString(body.type);
                if (body.pinned !== undefined) {
                    updates.pinned = body.pinned === true || body.pinned === "true";
                }
                updates.updatedAt = nowISO();

                collections.announcements.findOneAndUpdate(
                    { id: annId },
                    { $set: updates },
                    { returnDocument: "after" }
                ).then(function (result) {
                    if (!result || !result.value) {
                        sendError(res, 404, "Not found.");
                        return resolve(true);
                    }
                    sendJSON(res, 200, {
                        success: true,
                        message: "Updated.",
                        announcement: result.value
                    });
                    resolve(true);
                });
            });
        });
    }

    /* ============ DELETE ANNOUNCEMENT ============ */
    if (req.method === "DELETE" && pathname === "/api/admin/announcements") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        var annId = cleanString(query.get("id") || query.get("announcementId"));
        if (!annId) { sendError(res, 400, "ID required."); return Promise.resolve(true); }
        return collections.announcements.deleteOne({ id: annId })
            .then(function (result) {
                if (result.deletedCount === 0) {
                    sendError(res, 404, "Not found.");
                    return true;
                }
                sendJSON(res, 200, { success: true, message: "Deleted." });
                return true;
            });
    }

    /* ============ PAYMENT SETTINGS ============ */
    if (req.method === "GET" && pathname === "/api/payment-settings") {
        sendJSON(res, 200, { success: true, payment: PAYMENT_SETTINGS });
        return Promise.resolve(true);
    }

    /* ============ CSV EXPORT ============ */
    if (req.method === "GET" && pathname === "/api/admin/registrations.csv") {
        if (!requireAdmin(req, res)) return Promise.resolve(true);
        return collections.registrations.find({}).toArray()
            .then(function (regs) {
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

                regs.forEach(function (it) {
                    lines.push([
                        it.id,it.username,it.email,it.tournamentName,it.game,
                        it.teamName,it.captainName,it.phone,
                        it.player1,it.player2,it.player3,it.player4,it.player5,it.player6,
                        it.paymentMethod,it.transactionId,it.amount,
                        it.paymentStatus,it.status,it.createdAt
                    ].map(csv).join(","));
                });

                res.writeHead(200, {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": 'attachment; filename="nepplay-registrations.csv"'
                });
                res.end(lines.join("\r\n"));
                return true;
            });
    }

    /* ============ FAVICON FALLBACK ============ */
    if (pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return Promise.resolve(true);
    }

    return Promise.resolve(false);
}

/* ============================================================
   HTTP SERVER
============================================================ */

var server = http.createServer(function (req, res) {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        });
        res.end();
        return;
    }

    var parsed;
    try { parsed = new URL(req.url, "http://localhost:" + PORT); }
    catch (e) { sendError(res, 400, "Invalid URL."); return; }

    var pathname = parsed.pathname;
    var query = parsed.searchParams;

    if (pathname.indexOf("/api/") === 0) {
        handleAPI(req, res, pathname, query).then(function (handled) {
            if (!handled) {
                sendError(res, 404, "API route not found.");
            }
        });
        return;
    }

    serveStatic(req, res, pathname);
});

/* ============================================================
   START
============================================================ */

connectDB().then(function () {
    server.listen(PORT, HOST, function () {
        console.log("");
        console.log("==================================================");
        console.log("        NEPPLAY SERVER STARTED (MongoDB + D1 + D3)");
        console.log("==================================================");
        console.log("Local: http://localhost:" + PORT);
        console.log("Admin: " + ADMIN_USERNAME);
        console.log("Database: " + DB_NAME);
        console.log("eSewa: " + PAYMENT_SETTINGS.eSewa.number);
        console.log("Khalti: " + PAYMENT_SETTINGS.Khalti.number);
        console.log("==================================================");
        console.log("");
    });
});

server.on("error", function (error) {
    console.log("");
    console.log("SERVER ERROR:", error.message);
    if (error.code === "EADDRINUSE") {
        console.log("Port " + PORT + " is already in use.");
    }
    console.log("");
});
