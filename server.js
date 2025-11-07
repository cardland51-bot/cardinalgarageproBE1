// ===== IMPORTS =====
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CORE APP =====
const app = express();
const PORT = process.env.PORT || 10000;

// ===== OPENAI CLIENT =====
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===== MIDDLEWARE =====
app.use(cors({
  origin: [
    "https://cardinalgaragepro.com",
    "https://www.cardinalgaragepro.com",
    "https://jared-hero2-backend.onrender.com"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: [
    "http://localhost:5500",
    "https://cardinalgaragepro.com",
    "https://www.cardinalgaragepro.com",
    "https://jared-hero2-backend.onrender.com"
  ],
  methods: ["GET", "POST"],
  credentials: true
}));


// ===== FILE STORAGE (for train-collect logs) =====
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, "pipeline.json");
if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, "[]", "utf8");



// ====== CORE ROUTES =====

// --- Root Route ---
app.get("/", (req, res) => {
  res.send("✅ Cardinal GaragePro backend running.");
});

// --- Health Check ---
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    service: "Cardinal GaragePro backend",
    port: PORT,
    time: new Date().toISOString()
  });
});

// --- AI Inference (used by procalculator.html) ---
app.post("/inference", async (req, res) => {
  try {
    const body = req.body || {};
    const {
      mode = "generic", // "mowing" | "landscaping" | ...
      service = "",
      inputs = {},
      notes = "",
      photoSummary = ""
    } = body;

    const areaSqFt = Number(inputs.areaSqFt || 0);
    const shrubCount = Number(inputs.shrubCount || 0);
    const bedSize = (inputs.bedSize || "").toLowerCase();
    const material = (inputs.material || "").toLowerCase();

    // --- BASE PRICE LOGIC ---
    let base = 0;
    if (mode === "mowing" || service === "mowing") {
      base = areaSqFt ? Math.max(35, Math.min(125, 25 + areaSqFt * 0.03)) : 45;
    } else if (mode === "landscaping" || service === "landscaping") {
      base = 120;
      if (bedSize === "small") base += 60;
      if (bedSize === "medium") base += 140;
      if (bedSize === "large") base += 260;
      base += shrubCount * 6;
      if (material.includes("premium") || material.includes("stone")) base *= 1.25;
    } else {
      base = 75;
    }

    const price = Math.round(Math.max(45, base));
    let closePct = 72, upsellPct = 40, riskPct = 18;

    const lower = (notes + " " + photoSummary).toLowerCase();
    if (lower.includes("overgrown") || lower.includes("patchy") || lower.includes("neglected")) {
      riskPct += 18; upsellPct += 16;
    }
    if (lower.includes("clean") || lower.includes("fresh") || lower.includes("sharp")) {
      closePct += 10;
    }
    if (material.includes("premium") || material.includes("rock")) {
      upsellPct += 20;
    }

    closePct = Math.max(5, Math.min(98, closePct));
    upsellPct = Math.max(5, Math.min(98, upsellPct));
    riskPct = Math.max(3, Math.min(95, riskPct));

    const summary = [
      `Estimate: ~$${price}.`,
      upsellPct > 40
        ? `Solid upsell signal — highlight quality and longevity.`
        : `Keep it simple; lead with reliability.`,
      riskPct > 35
        ? `Flag risk items before starting to avoid rework.`
        : `Looks clean for one-visit or recurring setup.`
    ].join(" ");

    const responseData = {
      price,
      upsell: `+${Math.round((upsellPct / 100) * price)}`,
      summary,
      closePct,
      upsellPct,
      riskPct
    };

    // --- TRAIN LOG ---
    await fetch(`${process.env.BASE_URL || "https://jared-hero2-backend.onrender.com"}/train-collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "inference", payload: responseData })
    }).catch(() => {});

    res.json(responseData);
  } catch (err) {
    console.error("❌ /inference failed:", err);
    res.status(500).json({ error: "Inference failed" });
  }
});

// --- TRAIN COLLECT ---
app.post("/train-collect", async (req, res) => {
  try {
    const incoming = req.body || {};
    const old = fs.existsSync(logFile)
      ? JSON.parse(fs.readFileSync(logFile, "utf8"))
      : [];
    old.push({ t: Date.now(), ...incoming });
    fs.writeFileSync(logFile, JSON.stringify(old.slice(-200), null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ /train-collect error:", err);
    res.status(500).json({ error: "train-collect failed" });
  }
});

// --- TEXT TO SPEECH (optional for Jared voice) ---
app.post("/speak", async (req, res) => {
  try {
    const { text, voice = "alloy" } = req.body;
    const audio = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text
    });
    const buffer = Buffer.from(await audio.arrayBuffer());
    res.set({ "Content-Type": "audio/mpeg" });
    res.send(buffer);
  } catch (err) {
    console.error("❌ /speak error:", err);
    res.status(500).json({ error: "Speech failed" });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Cardinal GaragePro backend running on port ${PORT}`);
});
