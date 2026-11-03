require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  console.error("Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET in .env before starting.");
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters long.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({limit:"30kb"}));
app.use(session({
  name: "sjfc_admin_session",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

const loginLimiter = rateLimit({windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false});
const adminLimiter = rateLimit({windowMs: 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false});

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeData(data) {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({error:"Admin login required."});
  next();
}
function csrf(req, res, next) {
  if (!req.session.csrfToken || req.get("x-csrf-token") !== req.session.csrfToken) {
    return res.status(403).json({error:"Security token invalid. Refresh and try again."});
  }
  next();
}
function cleanPlayer(body) {
  const name = String(body.name || "").trim();
  const fields = ["winner", "runnerUp", "shield"];
  if (!name || name.length > 40) throw new Error("Player name must be 1–40 characters.");
  const result = {name};
  for (const field of fields) {
    const n = Number(body[field]);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error("Trophy counts must be whole numbers from 0 to 999.");
    result[field] = n;
  }
  return result;
}

app.get("/api/public", (req, res) => {
  const data = readData();
  const voteCounts = {};
  for (const p of data.players) voteCounts[p.name] = 0;
  for (const vote of (data.votes || [])) voteCounts[vote.player] = (voteCounts[vote.player] || 0) + 1;
  res.json({
    season:data.season, competitions:data.competitions, players:data.players,
    voting:{open:!!(data.voting && data.voting.open), total:(data.votes || []).length, counts:voteCounts}
  });
});

const voteLimiter = rateLimit({windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false});
app.post("/api/vote", voteLimiter, (req, res) => {
  const data = readData();
  if (!data.voting || !data.voting.open) return res.status(403).json({error:"Voting is currently closed."});
  const username = String(req.body.username || "").trim();
  const player = String(req.body.player || "").trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
    return res.status(400).json({error:"Username must be 3–24 characters using letters, numbers, dots, underscores or hyphens."});
  }
  if (!data.players.some(p => p.name === player)) return res.status(400).json({error:"Please select a valid player."});
  data.votes = data.votes || [];
  const normalized = username.toLowerCase();
  if (data.votes.some(v => v.username.toLowerCase() === normalized)) {
    return res.status(409).json({error:"This username has already voted. Each username can vote once."});
  }
  data.votes.push({username, player, createdAt:new Date().toISOString()});
  writeData(data);
  res.json({ok:true, total:data.votes.length});
});

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const userOk = crypto.timingSafeEqual(
    Buffer.from(username.padEnd(256).slice(0,256)),
    Buffer.from(String(process.env.ADMIN_USERNAME).padEnd(256).slice(0,256))
  );
  // Compare password hashes to avoid storing or directly comparing plaintext credentials.
  const configuredHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
  const passOk = await bcrypt.compare(password, configuredHash);
  if (!userOk || !passOk) return res.status(401).json({error:"Incorrect username or password."});
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:"Could not start secure session."});
    req.session.admin = true;
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    res.json({ok:true, csrfToken:req.session.csrfToken});
  });
});

app.get("/api/admin/session", (req, res) => {
  res.json({authenticated:!!req.session.admin, csrfToken:req.session.csrfToken || null});
});
app.post("/api/admin/logout", requireAdmin, csrf, (req, res) => {
  req.session.destroy(() => res.json({ok:true}));
});

app.use("/api/admin", adminLimiter);
app.use("/api/admin", requireAdmin, csrf);

app.put("/api/admin/players", (req, res) => {
  try {
    if (!Array.isArray(req.body.players) || req.body.players.length > 300) {
      return res.status(400).json({error:"Invalid player list."});
    }
    const players = req.body.players.map(cleanPlayer);
    const names = players.map(p => p.name.toLowerCase());
    if (new Set(names).size !== names.length) return res.status(400).json({error:"Player names must be unique."});
    const data = readData();
    data.players = players.sort((a,b) => a.name.localeCompare(b.name));
    writeData(data);
    res.json({ok:true, players:data.players});
  } catch (e) {
    res.status(400).json({error:e.message || "Could not save records."});
  }
});

app.put("/api/admin/settings", (req, res) => {
  const competitions = Number(req.body.competitions);
  const season = String(req.body.season || "").trim();
  if (!Number.isInteger(competitions) || competitions < 0 || competitions > 10000 || !season || season.length > 30) {
    return res.status(400).json({error:"Enter a valid season and competition count."});
  }
  const data = readData();
  data.season = season;
  data.competitions = competitions;
  data.voting = data.voting || {open:true};
  if (typeof req.body.votingOpen === "boolean") data.voting.open = req.body.votingOpen;
  writeData(data);
  res.json({ok:true});
});

app.get("/api/admin/votes", requireAdmin, (req, res) => {
  const data = readData();
  res.json({votes:data.votes || [], voting:data.voting || {open:true}});
});

app.delete("/api/admin/votes", requireAdmin, csrf, (req, res) => {
  const data = readData();
  data.votes = [];
  writeData(data);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`SJFC Ballon d’Or site running at http://localhost:${PORT}`));
