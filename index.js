import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import qrcode from "qrcode";
import fetch from "node-fetch";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";
import MongoStore from "connect-mongo";
import cookieParser from "cookie-parser";

import User from "./models/User.js";
import QR from "./models/QR.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://qrmanagerpro.vercel.app"; // 👈 URL fija para los QR

// --- Express config
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

// --- Session config (auto-expira en 1 minuto)
const sessSecret = process.env.SESSION_SECRET || "cambiame_localmente";
const mongoURI = process.env.MONGODB_URI;

app.use(
  session({
    secret: sessSecret,
    resave: false,
    saveUninitialized: false,
    store: mongoURI ? MongoStore.create({ mongoUrl: mongoURI }) : undefined,
    cookie: { 
      maxAge: 1000 * 60 * 1, // 🕐 1 minuto
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    },
    rolling: true // 🔁 reinicia contador con cada interacción
  })
);

// --- MongoDB connect
if (!mongoURI) {
  console.error("❌ ERROR: MONGODB_URI no está definida.");
} else {
  mongoose
    .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch((err) => console.error("❌ Error conectando a MongoDB:", err));
}

// --- locals middleware
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;

  // Persistencia de dark mode usando cookie
  let dark = req.cookies?.darkMode;
  if (dark === undefined) {
    dark = req.headers['sec-ch-prefers-color-scheme'] === "dark";
    res.cookie("darkMode", dark, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  } else {
    dark = dark === "true";
  }

  res.locals.darkMode = dark;
  next();
});

// Toggle dark mode con cookie
app.post("/toggle-darkmode", (req, res) => {
  const current = req.cookies?.darkMode === "true";
  const nextValue = !current;
  res.cookie("darkMode", nextValue, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  res.redirect(req.headers.referer || "/");
});

// ---------------------- RUTAS -------------------------

// Home
app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("index", { darkMode: res.locals.darkMode });
});

// Login
app.get("/login", (req, res) => {
  res.render("login", { error: null, darkMode: res.locals.darkMode });
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user)
      return res.render("login", { error: "Usuario no encontrado", darkMode: res.locals.darkMode });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.render("login", { error: "Contraseña incorrecta", darkMode: res.locals.darkMode });

    req.session.userId = user._id;
    req.session.username = user.username;
    user.lastLogin = new Date();
    await user.save();

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err);
    res.render("login", { error: "Error interno", darkMode: res.locals.darkMode });
  }
});

// Register
app.get("/register", (req, res) => {
  res.render("register", { error: null, darkMode: res.locals.darkMode });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password, passwordConfirm } = req.body;
    if (!username || !password)
      return res.render("register", { error: "Debes completar campos", darkMode: res.locals.darkMode });
    if (password !== passwordConfirm)
      return res.render("register", { error: "Contraseñas no coinciden", darkMode: res.locals.darkMode });

    const exists = await User.findOne({ username });
    if (exists)
      return res.render("register", { error: "Usuario ya existe", darkMode: res.locals.darkMode });

    const hash = await bcrypt.hash(password, 10);
    const created = await User.create({ username, password: hash });

    req.session.userId = created._id;
    req.session.username = created.username;
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Register error:", err);
    res.render("register", { error: "Error registrando usuario", darkMode: res.locals.darkMode });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// Dashboard
app.get("/dashboard", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const qrs = await QR.find({ owner: req.session.userId }).sort({ createdAt: -1 }).lean();
  qrs.forEach((q) => {
    if (q.lastScan) q.lastScan = new Date(q.lastScan);
  });

  res.render("dashboard", {
    qrs,
    currentUser: req.session.username,
    darkMode: res.locals.darkMode,
  });
});

// ✅ Generate QR con URL base fija
app.post("/generate", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  try {
    let { originalUrl } = req.body;
    if (!originalUrl || originalUrl.trim() === "") return res.redirect("/dashboard");

    originalUrl = originalUrl.trim();
    if (!/^https?:\/\//i.test(originalUrl)) {
      originalUrl = "https://" + originalUrl;
    }

    const id = nanoid(12);
    const internalUrl = `${BASE_URL}/qr/${id}`;

    let shortInternalUrl;
    try {
      const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`);
      shortInternalUrl = await r.text();
      if (!shortInternalUrl.startsWith("http")) shortInternalUrl = internalUrl;
    } catch (e) {
      console.error("is.gd error:", e);
      shortInternalUrl = internalUrl;
    }

    const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

    await QR.create({
      owner: req.session.userId,
      id,
      originalUrl,
      internalUrl,
      shortInternalUrl,
      qrDataUrl,
      scans: 0,
      lastScan: null,
    });

    await User.findByIdAndUpdate(req.session.userId, { $inc: { qrCount: 1 } });

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error creando QR:", err);
    res.status(500).send("Error generando QR");
  }
});

// Redirección QR
app.get("/qr/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const qr = await QR.findOne({ id });
    if (!qr) return res.status(404).send("QR no encontrado");

    qr.scans = (qr.scans || 0) + 1;
    qr.lastScan = new Date();
    await qr.save();

    res.redirect(qr.originalUrl);
  } catch (err) {
    console.error("Error al redirigir QR:", err);
    res.status(500).send("Error interno");
  }
});

// fallback
app.use((req, res) => res.status(404).send("Ruta no encontrada"));

// Start server
app.listen(PORT, () => console.log(`✅ Servidor en http://localhost:${PORT}`));
