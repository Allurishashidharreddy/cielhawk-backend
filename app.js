const API_BASE = window.CIELHAWK_API_BASE || "http://localhost:3000";

function getToken(){
  return localStorage.getItem("cielhawk_token") || "";
}

function getUser(){
  try { return JSON.parse(localStorage.getItem("cielhawk_user") || "null"); }
  catch { return null; }
}

function setSession(token, user){
  localStorage.setItem("cielhawk_token", token);
  localStorage.setItem("cielhawk_user", JSON.stringify(user));
}

function logout(){
  localStorage.removeItem("cielhawk_token");
  localStorage.removeItem("cielhawk_user");
  location.href = "login.html";
}

async function api(path, options={}){
  const headers = options.headers || {};
  if(!(options.body instanceof FormData)){
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if(token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {...options, headers});
  if(!res.ok){
    const text = await res.text();
    throw new Error(text || "API request failed");
  }
  return res.json();
}

function money(v){
  return "₹" + Number(v || 0).toLocaleString("en-IN");
}

function statusBadge(status){
  const s = String(status || "pending").toLowerCase();
  return `<span class="status ${s}">${s}</span>`;
}

function toast(message){
  let box = document.getElementById("toast");
  if(!box){
    box = document.createElement("div");
    box.id = "toast";
    box.className = "toast";
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.style.display = "block";
  setTimeout(() => box.style.display = "none", 3200);
}

function requireDemoRole(role){
  const user = getUser();
  if(!user){
    toast("Please login first.");
    setTimeout(()=> location.href = "login.html", 600);
    return false;
  }
  if(role && user.role !== role){
    toast("You do not have access to this page.");
    return false;
  }
  return true;
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}