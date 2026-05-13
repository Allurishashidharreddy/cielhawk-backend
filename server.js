// =====================================================
// FILE: server.js
// CielHawk Backend API
// Node.js + Express + Azure Table Storage + Azure Blob Storage
// =====================================================

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Razorpay = require("razorpay");
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024
  }
});

// =====================================================
// ENV CONFIG
// =====================================================

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const AZURE_STORAGE_KEY = process.env.AZURE_STORAGE_KEY;
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const BLOB_CONTAINER = process.env.BLOB_CONTAINER || "ads";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_later";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@cielhawk.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

if(!AZURE_STORAGE_ACCOUNT || !AZURE_STORAGE_KEY || !AZURE_STORAGE_CONNECTION_STRING){
  console.warn("⚠️ Missing Azure env variables. Add them in .env before production use.");
}

const credential = new AzureNamedKeyCredential(
  AZURE_STORAGE_ACCOUNT || "devstoreaccount1",
  AZURE_STORAGE_KEY || "dummy"
);

function tableClient(tableName){
  return new TableClient(
    `https://${AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    tableName,
    credential
  );
}

const tables = {
  screens: tableClient("Screens"),
  campaigns: tableClient("Campaigns"),
  devices: tableClient("Devices"),
  users: tableClient("Users"),
  payments: tableClient("Payments")
};
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});
const blobServiceClient = AZURE_STORAGE_CONNECTION_STRING
  ? BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING)
  : null;

// =====================================================
// HELPERS
// =====================================================

function id(prefix = "id"){
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function nowIso(){
  return new Date().toISOString();
}

function createToken(payload){
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d"
  });
}

function authMiddleware(req, res, next){
  try{
    const auth = req.headers.authorization || "";

    if(!auth.startsWith("Bearer ")){
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = auth.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;
    next();
  }catch(err){
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminOnly(req, res, next){
  if(!req.user || req.user.role !== "admin"){
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

function advertiserOnly(req, res, next){
  if(!req.user || req.user.role !== "advertiser"){
    return res.status(403).json({ error: "Advertiser access required" });
  }

  next();
}

function safeEntity(entity){
  const copy = { ...entity };
  delete copy.etag;
  delete copy["odata.metadata"];
  return copy;
}

function addMonths(date, months){
  const d = new Date(date);
  d.setMonth(d.getMonth() + Number(months || 1));
  return d;
}

function isVideo(filename = ""){
  const clean = String(filename).toLowerCase();
  return clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".mov");
}

function requireFields(body, fields){
  for(const field of fields){
    if(!body[field]){
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function getAuthUser(req){
  try{
    const auth = req.headers.authorization || "";
    if(!auth.startsWith("Bearer ")) return null;

    const token = auth.replace("Bearer ", "");
    return jwt.verify(token, JWT_SECRET);
  }catch(err){
    return null;
  }
}

async function createTablesIfNeeded(){
  for(const [name, client] of Object.entries(tables)){
    try{
      await client.createTable();
      console.log(`✅ Created table: ${name}`);
    }catch(err){
      if(err.statusCode !== 409){
        console.warn(`⚠️ Table init warning for ${name}:`, err.message);
      }
    }
  }

  if(blobServiceClient){
    try{
      const containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);
      await containerClient.createIfNotExists({ access: "blob" });
      console.log(`✅ Blob container ready: ${BLOB_CONTAINER}`);
    }catch(err){
      console.warn("⚠️ Blob container warning:", err.message);
    }
  }
}

async function listEntities(client, filter){
  const result = [];
  const entities = filter ? client.listEntities({ queryOptions: { filter } }) : client.listEntities();

  for await (const entity of entities){
    result.push(safeEntity(entity));
  }

  return result;
}

async function uploadCreative(file, folder = "creatives"){
  if(!file){
    throw new Error("No creative file provided.");
  }

  if(!blobServiceClient){
    throw new Error("Azure Blob Storage is not configured.");
  }

  const containerClient = blobServiceClient.getContainerClient(BLOB_CONTAINER);
  await containerClient.createIfNotExists({ access: "blob" });

  const ext = path.extname(file.originalname || "creative");
  const blobName = `${folder}/${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(file.buffer, {
    blobHTTPHeaders: {
      blobContentType: file.mimetype || "application/octet-stream"
    }
  });

  return {
    url: blockBlobClient.url,
    name: file.originalname || blobName,
    type: isVideo(file.originalname) ? "video" : "image"
  };
}

// =====================================================
// HEALTH
// =====================================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "CielHawk API",
    time: nowIso()
  });
});

// =====================================================
// REAL AUTH APIs
// =====================================================

app.post("/api/auth/advertiser/register", async (req, res) => {
  try{
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const company_name = String(req.body.company_name || req.body.name || "").trim();
    const phone = String(req.body.phone || "").trim();

    if(!email || !password || !company_name){
      return res.status(400).json({
        error: "Company name, email and password required"
      });
    }

    if(password.length < 6){
      return res.status(400).json({
        error: "Password must be at least 6 characters"
      });
    }

    let existing = null;

    try{
      existing = await tables.users.getEntity("user", email);
    }catch(err){
      existing = null;
    }

    if(existing){
      return res.status(400).json({
        error: "Account already exists. Please login."
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const entity = {
      partitionKey: "user",
      rowKey: email,
      id: email,
      email,
      role: "advertiser",
      company_name,
      phone,
      password_hash,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await tables.users.createEntity(entity);

    const token = createToken({
      email,
      role: "advertiser",
      company_name
    });

    res.json({
      ok: true,
      token,
      user: {
        email,
        role: "advertiser",
        company_name,
        phone
      }
    });
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/advertiser/login", async (req, res) => {
  try{
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if(!email || !password){
      return res.status(400).json({ error: "Email and password required" });
    }

    let user = null;

    try{
      user = await tables.users.getEntity("user", email);
    }catch(err){
      return res.status(401).json({ error: "Account not found. Please register first." });
    }

    const ok = await bcrypt.compare(password, user.password_hash || "");

    if(!ok){
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = createToken({
      email,
      role: "advertiser",
      company_name: user.company_name || ""
    });

    res.json({
      ok: true,
      token,
      user: {
        email,
        role: "advertiser",
        company_name: user.company_name || "",
        phone: user.phone || ""
      }
    });
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/admin/login", async (req, res) => {
  try{
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if(email !== String(ADMIN_EMAIL).toLowerCase() || password !== ADMIN_PASSWORD){
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const token = createToken({
      email,
      role: "admin"
    });

    res.json({
      ok: true,
      token,
      user: {
        email,
        role: "admin"
      }
    });
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ADMIN: SCREENS
// =====================================================

app.get("/api/admin/screens", async (req, res) => {
  try{
    const screens = await listEntities(tables.screens);
    res.json(screens);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/screens", async (req, res) => {
  try{
    requireFields(req.body, ["name", "location", "device_id"]);

    const rowKey = req.body.device_id;

    const entity = {
      partitionKey: "screen",
      rowKey,
      id: rowKey,
      name: req.body.name,
      location: req.body.location,
      device_id: req.body.device_id,
      price: Number(req.body.price || 0),
      slots: Number(req.body.slots || 0),
      booked_slots: Number(req.body.booked_slots || 0),
      latitude: Number(req.body.latitude || req.body.lat || 0),
      longitude: Number(req.body.longitude || req.body.lng || 0),
      footfall: req.body.footfall || "Available",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await tables.screens.upsertEntity(entity, "Replace");
    res.json(entity);
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/admin/screens/:id", async (req, res) => {
  try{
    const screenId = req.params.id;
    const existing = await tables.screens.getEntity("screen", screenId);

    const updated = {
      ...safeEntity(existing),
      name: req.body.name ?? existing.name,
      location: req.body.location ?? existing.location,
      device_id: req.body.device_id ?? existing.device_id,
      price: Number(req.body.price ?? existing.price ?? 0),
      slots: Number(req.body.slots ?? existing.slots ?? 0),
      booked_slots: Number(req.body.booked_slots ?? existing.booked_slots ?? 0),
      latitude: Number(req.body.latitude ?? existing.latitude ?? 0),
      longitude: Number(req.body.longitude ?? existing.longitude ?? 0),
      footfall: req.body.footfall ?? existing.footfall ?? "Available",
      updated_at: nowIso()
    };

    await tables.screens.upsertEntity(updated, "Replace");
    res.json(updated);
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/screens/:id", async (req, res) => {
  try{
    await tables.screens.deleteEntity("screen", req.params.id);
    res.json({ ok: true });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

// Advertiser sees screen inventory
app.get("/api/advertiser/screens", async (req, res) => {
  try{
    const screens = await listEntities(tables.screens);
    res.json(screens);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// ADVERTISER: CAMPAIGNS
// =====================================================

app.get("/api/advertiser/campaigns", async (req, res) => {
  try{
    const user = getAuthUser(req);
    const campaigns = await listEntities(tables.campaigns);

    if(user && user.role === "advertiser"){
      return res.json(campaigns.filter(c => String(c.owner_email || "").toLowerCase() === String(user.email).toLowerCase()));
    }

    res.json(campaigns);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/advertiser/campaigns/book-slot", upload.single("creative"), async (req, res) => {
  try{
    requireFields(req.body, ["title", "screen_id", "screen_name", "device_id", "duration_months"]);

    const user = getAuthUser(req);
    const creative = await uploadCreative(req.file, "campaign-creatives");

    const campaignId = id("camp");
    const months = Number(req.body.duration_months || 1);
    const monthlyPrice = Number(req.body.monthly_price || 0);
    const totalAmount = Number(req.body.total_amount || monthlyPrice * months);

    const startDate = new Date();
    const endDate = addMonths(startDate, months);

    const entity = {
      partitionKey: "campaign",
      rowKey: campaignId,
      id: campaignId,
      title: req.body.title,
      goal: req.body.goal || "",
      screen_id: req.body.screen_id,
      screen_name: req.body.screen_name,
      device_id: req.body.device_id,
      duration_months: months,
      monthly_price: monthlyPrice,
      total_amount: totalAmount,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      payment_status: "paid",
      campaign_status: "active",
      approval_status: "pending",
      creative_status: "pending",
      current_creative_url: "",
      current_creative_name: "",
      pending_creative_url: creative.url,
      pending_creative_name: creative.name,
      pending_creative_type: creative.type,
      owner_name: req.body.owner_name || user?.company_name || "Advertiser",
      owner_email: req.body.owner_email || user?.email || "advertiser@example.com",
      owner_phone: req.body.owner_phone || req.body.phone || "-",
      payment_status: req.body.payment_status || "paid",
      campaign_status: req.body.campaign_status || "active",
      payment_id: req.body.payment_id || "",
    };

    await tables.campaigns.createEntity(entity);

    try{
      const screen = await tables.screens.getEntity("screen", req.body.screen_id);
      const updatedScreen = {
        ...safeEntity(screen),
        booked_slots: Number(screen.booked_slots || 0) + 1,
        updated_at: nowIso()
      };
      await tables.screens.upsertEntity(updatedScreen, "Replace");
    }catch(err){
      console.warn("Could not update booked slots:", err.message);
    }

    res.json({ ok: true, campaign: entity });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/advertiser/campaigns/:id/creative-change", upload.single("creative"), async (req, res) => {
  try{
    const campaignId = req.params.id;
    const campaign = await tables.campaigns.getEntity("campaign", campaignId);
    const user = getAuthUser(req);

    if(user && user.role === "advertiser" && String(campaign.owner_email || "").toLowerCase() !== String(user.email).toLowerCase()){
      return res.status(403).json({ error: "You can update only your own campaign" });
    }

    const creative = await uploadCreative(req.file, "creative-changes");

    const updated = {
      ...safeEntity(campaign),
      pending_creative_url: creative.url,
      pending_creative_name: creative.name,
      pending_creative_type: creative.type,
      creative_status: "pending",
      updated_at: nowIso()
    };

    await tables.campaigns.upsertEntity(updated, "Replace");
    res.json({ ok: true, campaign: updated });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/advertiser/campaigns/:id", async (req, res) => {
  try{
    const campaignId = req.params.id;
    const campaign = await tables.campaigns.getEntity("campaign", campaignId);
    const user = getAuthUser(req);

    if(user && user.role === "advertiser" && String(campaign.owner_email || "").toLowerCase() !== String(user.email).toLowerCase()){
      return res.status(403).json({ error: "You can delete only your own campaign" });
    }

    await tables.campaigns.deleteEntity("campaign", campaignId);
    res.json({ ok: true });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

// =====================================================
// ADMIN: CAMPAIGNS + APPROVALS
// =====================================================

app.get("/api/admin/campaigns", async (req, res) => {
  try{
    const campaigns = await listEntities(tables.campaigns);
    res.json(campaigns);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/campaigns/:id/approval", async (req, res) => {
  try{
    const campaignId = req.params.id;
    const status = req.body.approval_status || "pending";
    const campaign = await tables.campaigns.getEntity("campaign", campaignId);

    const updated = {
      ...safeEntity(campaign),
      approval_status: status,
      creative_status: status === "approved" ? "approved" : campaign.creative_status,
      updated_at: nowIso()
    };

    if(status === "approved" && campaign.pending_creative_url){
      updated.current_creative_url = campaign.pending_creative_url;
      updated.current_creative_name = campaign.pending_creative_name;
      updated.current_creative_type = campaign.pending_creative_type || "image";
      updated.pending_creative_url = "";
      updated.pending_creative_name = "";
      updated.pending_creative_type = "";
    }

    await tables.campaigns.upsertEntity(updated, "Replace");
    res.json({ ok: true, campaign: updated });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/campaigns/:id", async (req, res) => {
  try{
    await tables.campaigns.deleteEntity("campaign", req.params.id);
    res.json({ ok: true });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

// =====================================================
// ADMIN: CREATIVE REQUESTS
// =====================================================

app.get("/api/admin/creative-requests", async (req, res) => {
  try{
    const campaigns = await listEntities(tables.campaigns);
    const pending = campaigns.filter(c => c.pending_creative_url && String(c.creative_status || "").toLowerCase() === "pending");
    res.json(pending);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/creative-requests/:id/approve", async (req, res) => {
  try{
    const campaignId = req.params.id;
    const campaign = await tables.campaigns.getEntity("campaign", campaignId);

    const updated = {
      ...safeEntity(campaign),
      current_creative_url: campaign.pending_creative_url,
      current_creative_name: campaign.pending_creative_name,
      current_creative_type: campaign.pending_creative_type || "image",
      pending_creative_url: "",
      pending_creative_name: "",
      pending_creative_type: "",
      creative_status: "approved",
      approval_status: "approved",
      updated_at: nowIso()
    };

    await tables.campaigns.upsertEntity(updated, "Replace");
    res.json({ ok: true, campaign: updated });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/admin/creative-requests/:id/reject", async (req, res) => {
  try{
    const campaignId = req.params.id;
    const campaign = await tables.campaigns.getEntity("campaign", campaignId);

    const updated = {
      ...safeEntity(campaign),
      pending_creative_url: "",
      pending_creative_name: "",
      pending_creative_type: "",
      creative_status: "rejected",
      updated_at: nowIso()
    };

    await tables.campaigns.upsertEntity(updated, "Replace");
    res.json({ ok: true, campaign: updated });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

// =====================================================
// PLAYER APIs
// =====================================================

app.get("/api/player/ads", async (req, res) => {
  try{
    const device = req.query.device;
    if(!device) return res.status(400).json({ error: "device query parameter required" });

    const campaigns = await listEntities(tables.campaigns);
    const now = new Date();

    const ads = campaigns
      .filter(c => String(c.device_id) === String(device))
      .filter(c => String(c.payment_status || "").toLowerCase() === "paid")
      .filter(c => String(c.approval_status || "").toLowerCase() === "approved")
      .filter(c => c.current_creative_url)
      .filter(c => {
        const end = new Date(c.end_date);
        return Number.isNaN(end.getTime()) || end >= now;
      })
      .map(c => ({
        id: c.id || c.rowKey,
        campaign_title: c.title,
        title: c.current_creative_name || c.title,
        fileUrl: c.current_creative_url,
        current_creative_url: c.current_creative_url,
        type: c.current_creative_type || (isVideo(c.current_creative_name) ? "video" : "image")
      }));

    res.json(ads);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/player/heartbeat", async (req, res) => {
  try{
    const deviceId = req.body.device_id;
    if(!deviceId) return res.status(400).json({ error: "device_id required" });

    const entity = {
      partitionKey: "device",
      rowKey: deviceId,
      id: deviceId,
      device_id: deviceId,
      status: req.body.status || "online",
      last_seen: req.body.last_seen || nowIso(),
      current_campaign: req.body.current_campaign || "-",
      current_ad: req.body.current_ad || "-",
      current_index: Number(req.body.current_index || 0),
      total_ads: Number(req.body.total_ads || 0),
      cache_mode: Boolean(req.body.cache_mode || false),
      last_sync_time: req.body.last_sync_time || "",
      page_url: req.body.page_url || "",
      app_version: req.body.app_version || "cielhawk-player",
      updated_at: nowIso()
    };

    await tables.devices.upsertEntity(entity, "Replace");
    res.json({ ok: true });
  }catch(err){
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/devices", async (req, res) => {
  try{
    const devices = await listEntities(tables.devices);
    res.json(devices);
  }catch(err){
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// PAYMENT + INVOICE APIs
// =====================================================

// =====================================================
// PAYMENT + INVOICE APIs
// =====================================================

app.post("/api/payments/create-order", async (req, res) => {
  try{
    const amount = Number(req.body.amount || req.body.total_amount || 0);

    if(amount <= 0){
      return res.status(400).json({
        error: "Invalid payment amount"
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        campaign_id: req.body.campaign_id || "",
        action_type: req.body.action_type || "campaign_payment"
      }
    });

    const paymentId = id("pay");

    const entity = {
      partitionKey: "payment",
      rowKey: paymentId,
      id: paymentId,
      razorpay_order_id: order.id,
      campaign_id: req.body.campaign_id || "",
      amount,
      currency: "INR",
      status: "created",
      action_type: req.body.action_type || "campaign_payment",
      created_at: nowIso()
    };

    await tables.payments.createEntity(entity);

    res.json({
      ok: true,
      order,
      payment: entity,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID
    });

  }catch(err){
    res.status(500).json({
      error: err.message
    });
  }
});

app.post("/api/payments/verify", async (req, res) => {
  try{
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      campaign_id
    } = req.body;

    if(!razorpay_order_id || !razorpay_payment_id || !razorpay_signature){
      return res.status(400).json({
        error: "Missing payment verification details"
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if(expectedSignature !== razorpay_signature){
      return res.status(400).json({
        error: "Payment verification failed"
      });
    }

    if(campaign_id){
      const campaign = await tables.campaigns.getEntity(
        "campaign",
        campaign_id
      );

      const updatedCampaign = {
        ...safeEntity(campaign),
        payment_status: "paid",
        campaign_status: "active",
        payment_id: razorpay_payment_id,
        updated_at: nowIso()
      };

      await tables.campaigns.upsertEntity(
        updatedCampaign,
        "Replace"
      );
    }

    res.json({
      ok: true,
      payment_status: "paid",
      razorpay_payment_id
    });

  }catch(err){
    res.status(500).json({
      error: err.message
    });
  }
});

app.get("/api/invoices/:campaignId", async (req, res) => {
  try{
    const campaign = await tables.campaigns.getEntity(
      "campaign",
      req.params.campaignId
    );

    res.json(safeEntity(campaign));

  }catch(err){
    res.status(404).json({
      error: "Invoice/campaign not found"
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

createTablesIfNeeded().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 CielHawk API running on http://localhost:${PORT}`);
  });
});
