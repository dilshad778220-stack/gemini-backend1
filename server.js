import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// --- Firebase Admin Setup ---
const serviceAccountPath = path.resolve("./serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "demo-key");

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// --- Save chat to Firestore ---
async function saveChat(uid, role, text) {
  const docRef = db.collection("chats").doc(uid);
  await docRef.set(
    { history: admin.firestore.FieldValue.arrayUnion({ role, text, timestamp: new Date() }) },
    { merge: true }
  );
}

// --- Get chat history ---
app.get("/api/history/:uid", async (req, res) => {
  const uid = req.params.uid;
  try {
    const doc = await db.collection("chats").doc(uid).get();
    const history = doc.exists ? doc.data().history : [];
    res.json({ success: true, history });
  } catch (err) {
    console.error(err);
    res.json({ success: false, history: [], message: err.message });
  }
});

// --- Gemini AI Endpoint ---
app.post("/api/gemini", async (req, res) => {
  try {
    const { uid, prompt } = req.body;
    if (!prompt) return res.status(400).json({ success: false, reply: "Prompt is required" });

    await saveChat(uid, "user", prompt);

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "demo-key") {
      const demoReply = `I'm Gemini AI! You said: "${prompt}". Set GEMINI_API_KEY in .env for real responses.`;
      await saveChat(uid, "assistant", demoReply);
      return res.json({ success: true, reply: demoReply });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95 },
    });

    let text;
    for (let i = 0; i < 3; i++) {
      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        text = await response.text();
        break;
      } catch (err) {
        console.log("⚠️ Gemini API overloaded, retrying...");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!text) text = "Gemini API is currently busy. Please try again later.";

    await saveChat(uid, "assistant", text);
    res.json({ success: true, reply: text });
  } catch (err) {
    console.error("❌ Gemini API Error:", err);
    res.json({ success: false, reply: "Server error: " + err.message });
  }
});

// --- Health Check ---
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", port, timestamp: new Date().toISOString() });
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  const hasApiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "demo-key");
  if (hasApiKey) console.log("✅ GEMINI_API_KEY is set");
  else console.log("🔶 DEMO MODE - set GEMINI_API_KEY in .env for real AI");
});
