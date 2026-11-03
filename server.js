require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";
if (!process.env.DATABASE_URL || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
  console.error("Missing DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD or SESSION_SECRET."); process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) { console.error("SESSION_SECRET must be at least 32 characters."); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false } });
const passwordHashPromise = bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'"], scriptSrc:["'self'"], imgSrc:["'self'","data:"], connectSrc:["'self'"], objectSrc:["'none'"], upgradeInsecureRequests:isProduction?[]:null } }}));
app.use(express.json({limit:"30kb"}));
app.use(session({ name:"sjfc_admin_session", store:new PgSession({ pool, tableName:"user_sessions", createTableIfMissing:true }), secret:process.env.SESSION_SECRET, resave:false, saveUninitialized:false, cookie:{httpOnly:true,secure:isProduction,sameSite:"strict",maxAge:1000*60*60*4} }));
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:"draft-7",legacyHeaders:false});
const adminLimiter=rateLimit({windowMs:60*1000,limit:60,standardHeaders:"draft-7",legacyHeaders:false});
const voteLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-7",legacyHeaders:false});
async function getData(client=pool){ const r=await client.query("SELECT payload FROM sjfc_app_state WHERE id=1"); return r.rows[0].payload; }
function requireAdmin(req,res,next){ if(!req.session.admin) return res.status(401).json({error:"Admin login required."}); next(); }
function csrf(req,res,next){ if(["GET","HEAD","OPTIONS"].includes(req.method)) return next(); if(!req.session.csrfToken || req.get("x-csrf-token")!==req.session.csrfToken) return res.status(403).json({error:"Security token invalid. Refresh and try again."}); next(); }
function cleanPlayer(body){ const name=String(body.name||"").trim(); if(!name||name.length>40) throw new Error("Player name must be 1–40 characters."); const result={name}; for(const f of ["winner","runnerUp","shield"]){const n=Number(body[f]);if(!Number.isInteger(n)||n<0||n>999)throw new Error("Trophy counts must be whole numbers from 0 to 999.");result[f]=n;}return result; }
app.get("/api/public",async(req,res,next)=>{try{const d=await getData();const counts={};for(const p of d.players)counts[p.name]=0;for(const v of d.votes||[])counts[v.player]=(counts[v.player]||0)+1;res.json({season:d.season,competitions:d.competitions,players:d.players,voting:{open:!!d.voting?.open,total:(d.votes||[]).length,counts}});}catch(e){next(e);}});
app.post("/api/vote",voteLimiter,async(req,res,next)=>{const client=await pool.connect();try{await client.query("BEGIN");const r=await client.query("SELECT payload FROM sjfc_app_state WHERE id=1 FOR UPDATE");const d=r.rows[0].payload;if(!d.voting?.open){await client.query("ROLLBACK");return res.status(403).json({error:"Voting is currently closed."});}const username=String(req.body.username||"").trim();const player=String(req.body.player||"").trim();if(!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)){await client.query("ROLLBACK");return res.status(400).json({error:"Username must be 3–24 characters using letters, numbers, dots, underscores or hyphens."});}if(!d.players.some(p=>p.name===player)){await client.query("ROLLBACK");return res.status(400).json({error:"Please select a valid player."});}d.votes=d.votes||[];if(d.votes.some(v=>v.username.toLowerCase()===username.toLowerCase())){await client.query("ROLLBACK");return res.status(409).json({error:"This username has already voted. Each username can vote once."});}d.votes.push({username,player,createdAt:new Date().toISOString()});await client.query("UPDATE sjfc_app_state SET payload=$1::jsonb WHERE id=1",[JSON.stringify(d)]);await client.query("COMMIT");res.json({ok:true,total:d.votes.length});}catch(e){await client.query("ROLLBACK");next(e);}finally{client.release();}});
app.post("/api/admin/login",loginLimiter,async(req,res,next)=>{try{const username=String(req.body.username||"");const password=String(req.body.password||"");const userOk=username===process.env.ADMIN_USERNAME;const passOk=await bcrypt.compare(password,await passwordHashPromise);if(!userOk||!passOk)return res.status(401).json({error:"Incorrect username or password."});req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Could not start secure session."});req.session.admin=true;req.session.csrfToken=crypto.randomBytes(32).toString("hex");req.session.save(e=>{if(e)return res.status(500).json({error:"Could not save secure session."});res.json({ok:true,csrfToken:req.session.csrfToken});});});}catch(e){next(e);}});
app.get("/api/admin/session",(req,res)=>res.json({authenticated:!!req.session.admin,csrfToken:req.session.csrfToken||null}));
app.use("/api/admin",adminLimiter,requireAdmin,csrf);
app.post("/api/admin/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.put("/api/admin/players",async(req,res,next)=>{try{if(!Array.isArray(req.body.players)||req.body.players.length>300)return res.status(400).json({error:"Invalid player list."});const players=req.body.players.map(cleanPlayer);const names=players.map(p=>p.name.toLowerCase());if(new Set(names).size!==names.length)return res.status(400).json({error:"Player names must be unique."});const c=await pool.connect();try{await c.query("BEGIN");const d=await getData(c);d.players=players.sort((a,b)=>a.name.localeCompare(b.name));await c.query("UPDATE sjfc_app_state SET payload=$1::jsonb WHERE id=1",[JSON.stringify(d)]);await c.query("COMMIT");res.json({ok:true,players:d.players});}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}catch(e){if(e.message) return res.status(400).json({error:e.message});next(e);}});
app.put("/api/admin/settings",async(req,res,next)=>{try{const competitions=Number(req.body.competitions);const season=String(req.body.season||"").trim();if(!Number.isInteger(competitions)||competitions<0||competitions>10000||!season||season.length>30)return res.status(400).json({error:"Enter a valid season and competition count."});const d=await getData();d.season=season;d.competitions=competitions;d.voting=d.voting||{open:true};if(typeof req.body.votingOpen==="boolean")d.voting.open=req.body.votingOpen;await pool.query("UPDATE sjfc_app_state SET payload=$1::jsonb WHERE id=1",[JSON.stringify(d)]);res.json({ok:true});}catch(e){next(e);}});
app.get("/api/admin/votes",async(req,res,next)=>{try{const d=await getData();res.json({votes:d.votes||[],voting:d.voting||{open:true}});}catch(e){next(e);}});
app.delete("/api/admin/votes",async(req,res,next)=>{try{const d=await getData();d.votes=[];await pool.query("UPDATE sjfc_app_state SET payload=$1::jsonb WHERE id=1",[JSON.stringify(d)]);res.json({ok:true});}catch(e){next(e);}});
app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"A server error occurred. Please try again."});});
async function start(){await pool.query("CREATE TABLE IF NOT EXISTS sjfc_app_state (id integer PRIMARY KEY, payload jsonb NOT NULL)");const seed=JSON.parse(fs.readFileSync(path.join(__dirname,"data.json"),"utf8"));await pool.query("INSERT INTO sjfc_app_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING",[JSON.stringify(seed)]);app.listen(PORT,()=>console.log(`SJFC Ballon d’Or site running on port ${PORT}`));}
start().catch(e=>{console.error("Startup failed:",e);process.exit(1);});
