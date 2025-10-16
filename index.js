/*******************************************************************
 *  OLAH Bestel Taxi - FCM HTTP v1 Secure Server
 *******************************************************************/
const express = require("express");
const fetch = require("node-fetch");
const { google } = require("google-auth-library");
const app = express();
app.use(express.json());

// =============== تحميل بيانات الحساب الخدمي ====================
const serviceAccount = require("./service-account.json");
const projectId = serviceAccount.project_id;

// =============== إعداد المتغيرات البيئية ========================
const rawKeys = process.env.API_KEYS;
const ALLOWED_WINDOW_SEC = Number(process.env.ALLOWED_WINDOW_SEC || 60);

if (!rawKeys) {
  console.error("❌ API_KEYS مفقود. أضفه في Environment Variables في Render.");
  process.exit(1);
}

const VALID_API_KEYS = new Set(rawKeys.split(",").map(k => k.trim()).filter(Boolean));
let blockedSerials = [];

// =============== مصادقة FCM HTTP v1 ==============================
async function getAccessToken() {
  const client = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  await client.authorize();
  return client.credentials.access_token;
}

async function sendFcmV1Notification(payload) {
  const accessToken = await getAccessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({ message: payload })
  });

  const json = await resp.json();
  console.log("📩 FCM response:", json);
  return json;
}

// =============== Middleware للتحقق من API key + timestamp ==========
function apiKeyTimestampMiddleware(req, res, next) {
  const key = req.get("x-api-key");
  const timestamp = req.get("x-timestamp");

  if (!key || !timestamp) return res.status(400).send("Missing auth headers");
  if (!VALID_API_KEYS.has(key)) return res.status(401).send("Invalid API key");

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return res.status(400).send("Invalid timestamp");

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > ALLOWED_WINDOW_SEC)
    return res.status(401).send("Stale timestamp");

  next();
}

// =============== استقبال الطلب من ESP ============================
app.post("/request", apiKeyTimestampMiddleware, async (req, res) => {
  try {
    const { serial, location, type } = req.body;
    if (!serial || !location || !type) return res.status(400).send("Missing fields");

    if (blockedSerials.includes(serial)) {
      console.log(`⛔ الجهاز ${serial} مرفوض`);
      return res.status(403).send("Device blocked");
    }

    const timeStr = new Date().toLocaleString("ar-SY", { timeZone: "Asia/Damascus" });
    const title = `🚕 طلب سيارة نوع ${type}`;
    const body = `الجهاز ذو الرقم ${serial} المركب بمكان ${location} طلب سيارة ${type} في ${timeStr}`;

    const fcmPayload = {
      topic: "requests",
      notification: { title, body },
      data: { serial, location, type, time: timeStr }
    };

    const fcmResult = await sendFcmV1Notification(fcmPayload);
    res.json({ ok: true, fcm: fcmResult });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// =============== تحديث قائمة الأجهزة المرفوضة ====================
app.post("/update-blocked", (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).send("Invalid list format");
  blockedSerials = list;
  console.log("🔄 Blocked list updated:", blockedSerials);
  res.send("Blocked list updated successfully");
});

// =============== اختبار بسيط =====================================
app.get("/", (req, res) => {
  res.send("OLAH bestel taxi server running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
