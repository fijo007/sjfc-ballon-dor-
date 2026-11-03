const $ = (id) => document.getElementById(id);
let currentData = {season:"2025/26", competitions:44, players:[]};
let csrfToken = null;

async function api(url, options={}) {
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (csrfToken && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, {...options, headers, credentials:"same-origin"});
  const payload = await response.json().catch(()=>({error:"Unexpected server response."}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function renderTable() {
  const q = $("search").value.trim().toLowerCase();
  const list = currentData.players.filter(p=>p.name.toLowerCase().includes(q));
  $("playerCount").textContent = currentData.players.length;
  $("competitionCount").textContent = currentData.competitions;
  $("seasonLabel").textContent = currentData.season;
  $("footCompetitions").textContent = currentData.competitions;
  $("shownCount").textContent = `${list.length} PLAYER${list.length===1?"":"S"}`;
  $("playerRows").innerHTML = list.length ? list.map(p=>`<tr><td>${escapeHtml(p.name)}</td><td>${p.winner}</td><td>${p.runnerUp}</td><td>${p.shield}</td></tr>`).join("") : `<tr><td colspan="4" class="loading">No players found.</td></tr>`;
}
function renderVoting() {
  const voting = currentData.voting || {open:false,total:0,counts:{}};
  $("voteStatus").textContent = voting.open ? "VOTING OPEN" : "VOTING CLOSED";
  $("voteStatus").classList.toggle("closed", !voting.open);
  $("votePlayer").innerHTML = `<option value="">Choose a player</option>` + currentData.players.map(p=>`<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
  $("voterUsername").disabled = !voting.open;
  $("votePlayer").disabled = !voting.open;
  $("castVote").disabled = !voting.open;
  $("castVote").style.opacity = voting.open ? "1" : ".45";
  $("totalVotes").textContent = `${voting.total || 0} VOTE${voting.total===1?"":"S"}`;
  const entries = currentData.players.map(p=>({name:p.name,count:(voting.counts||{})[p.name]||0})).sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name));
  const max = Math.max(1,...entries.map(e=>e.count));
  $("voteBars").innerHTML = entries.map(e=>`<div class="vote-bar-row"><span>${escapeHtml(e.name)}</span><div class="vote-bar-track"><div class="vote-bar-fill" style="width:${(e.count/max)*100}%"></div></div><b>${e.count}</b></div>`).join("");
}
async function loadPublic() {
  try {
    const data = await api("/api/public");
    currentData = data;
    currentData.players.sort((a,b)=>a.name.localeCompare(b.name));
    renderTable();
    renderVoting();
  } catch(e) {
    $("playerRows").innerHTML = `<tr><td colspan="4" class="loading">Could not load records. Please refresh.</td></tr>`;
  }
}
function openModal(){ $("adminModal").hidden=false; document.body.style.overflow="hidden"; }
function closeModal(){ $("adminModal").hidden=true; document.body.style.overflow=""; }
function showDashboard() {
  $("loginView").hidden=true; $("dashboardView").hidden=false;
  $("seasonInput").value=currentData.season;
  $("competitionInput").value=currentData.competitions;
  $("votingOpen").checked=!!(currentData.voting && currentData.voting.open);
  renderEditor();
  loadAdminVotes();
}
function showLogin() { $("loginView").hidden=false; $("dashboardView").hidden=true; $("loginMessage").textContent=""; }
function renderEditor() {
  $("editRows").innerHTML = currentData.players.map((p,i)=>`
    <div class="edit-row" data-index="${i}">
      <input aria-label="Player name" data-field="name" value="${escapeHtml(p.name)}" maxlength="40">
      <input aria-label="Winner count" data-field="winner" type="number" min="0" max="999" value="${p.winner}">
      <input aria-label="Runner-up count" data-field="runnerUp" type="number" min="0" max="999" value="${p.runnerUp}">
      <input aria-label="Shield count" data-field="shield" type="number" min="0" max="999" value="${p.shield}">
      <button class="remove" type="button" aria-label="Remove ${escapeHtml(p.name)}" title="Remove">×</button>
    </div>`).join("") || `<p class="empty">No players yet. Add the first player.</p>`;
  $("editRows").querySelectorAll(".edit-row").forEach(row=>{
    row.querySelectorAll("input").forEach(input=>input.addEventListener("input",()=>{
      const idx=Number(row.dataset.index), field=input.dataset.field;
      currentData.players[idx][field]=field==="name"?input.value:Number(input.value);
    }));
    row.querySelector(".remove").addEventListener("click",()=>{
      currentData.players.splice(Number(row.dataset.index),1); renderEditor();
    });
  });
}
async function loadAdminVotes() {
  try {
    const result=await api("/api/admin/votes");
    $("votingOpen").checked=!!result.voting.open;
    $("adminVoteSummary").textContent=`${result.votes.length} total votes recorded. Usernames are visible to admin; voters are not identity-verified.`;
  } catch(e) { $("adminVoteSummary").textContent=e.message; }
}
async function checkSession() {
  try {
    const s=await api("/api/admin/session");
    if(s.authenticated){csrfToken=s.csrfToken;showDashboard();} else showLogin();
  } catch(e){showLogin();}
}
$("search").addEventListener("input",renderTable);
$("openAdmin").addEventListener("click",()=>{openModal();checkSession();});
$("footerAdmin").addEventListener("click",e=>{e.preventDefault();openModal();checkSession();});
$("closeAdmin").addEventListener("click",closeModal);
$("adminModal").addEventListener("click",e=>{if(e.target===$("adminModal"))closeModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("adminModal").hidden)closeModal();});
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();$("loginMessage").textContent="Signing in…";
  const fd=new FormData(e.currentTarget);
  try {
    const result=await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:fd.get("username"),password:fd.get("password")})});
    csrfToken=result.csrfToken;
    await loadPublic();showDashboard();
  } catch(err){$("loginMessage").textContent=err.message;}
});
$("addPlayer").addEventListener("click",()=>{currentData.players.push({name:"",winner:0,runnerUp:0,shield:0});renderEditor();});
$("saveAll").addEventListener("click",async()=>{
  $("saveMessage").textContent="Saving…";
  try {
    currentData.season=$("seasonInput").value.trim();
    currentData.competitions=Number($("competitionInput").value);
    const settings=await api("/api/admin/settings",{method:"PUT",body:JSON.stringify({season:currentData.season,competitions:currentData.competitions,votingOpen:$("votingOpen").checked})});
    const result=await api("/api/admin/players",{method:"PUT",body:JSON.stringify({players:currentData.players})});
    currentData.players=result.players;renderTable();renderEditor();
    $("saveMessage").textContent="Changes saved successfully.";
  } catch(err){$("saveMessage").textContent=err.message;}
});
$("resetVotes").addEventListener("click",async()=>{
  if(!confirm("Reset all recorded votes? This cannot be undone.")) return;
  try {
    await api("/api/admin/votes",{method:"DELETE",body:"{}"});
    $("saveMessage").textContent="All votes have been reset.";
    await loadAdminVotes(); await loadPublic();
  } catch(err){$("saveMessage").textContent=err.message;}
});
$("voteForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("voteMessage").textContent="Submitting vote…";
  try {
    await api("/api/vote",{method:"POST",body:JSON.stringify({username:$("voterUsername").value.trim(),player:$("votePlayer").value})});
    $("voteMessage").textContent="Your free vote has been recorded. Thank you!";
    $("voteForm").reset(); await loadPublic();
  } catch(err){$("voteMessage").textContent=err.message;}
});
$("logout").addEventListener("click",async()=>{
  try{await api("/api/admin/logout",{method:"POST",body:"{}"});}catch(e){}
  csrfToken=null;showLogin();$("loginForm").reset();$("loginMessage").textContent="You have signed out.";
});
loadPublic();
