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
app.set("trust proxy", 1); // necesario para Vercel y cookies seguras detrás de proxy

const PORT = process.env.PORT || 3000;

// --- Express / view config
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser()); // ✅ cookies

// --- Session
const sessSecret = process.env.SESSION_SECRET || "cambiame_localmente";
const mongoURI = process.env.MONGODB_URI;

app.use(
  session({
    secret: sessSecret,
    resave: false,
    saveUninitialized: false,
    store: mongoURI ? MongoStore.create({ mongoUrl: mongoURI }) : undefined,
    cookie: { 
      maxAge: 1000 * 60 * 60 * 24, // 1 día
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    },
  })
);

// --- MongoDB connect
if (!mongoURI) {
  console.error("❌ ERROR: MONGODB_URI no está definida. Ponla en las variables de entorno.");
} else {
  mongoose
    .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Conectado a MongoDB"))
    .catch((err) => console.error("❌ Error conectando a MongoDB:", err));
}

// --- locals middleware
app.use((req, res, next) => {
  res.locals.currentUser = req.session.username || null;

  // 1️⃣ lee darkMode de cookie si existe
  let dark = req.cookies?.darkMode;
  if (dark === undefined) {
    // 2️⃣ si no existe cookie, aplica preferencia del sistema (light/dark)
    dark = req.headers['sec-ch-prefers-color-scheme'] || "light";
    dark = dark === "dark";
    // guarda cookie por defecto
    res.cookie("darkMode", dark, { maxAge: 1000*60*60*24*365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  } else {
    dark = dark === "true";
  }

  res.locals.darkMode = dark || !!req.session.darkMode;
  next();
});

// Toggle dark mode con cookie
app.post("/toggle-darkmode", (req, res) => {
  const current = req.cookies?.darkMode === "true";
  const nextValue = !current;
  res.cookie("darkMode", nextValue, { maxAge: 1000*60*60*24*365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  req.session.darkMode = nextValue;
  res.redirect(req.headers.referer || "/");
});

// ---------------------- RUTAS -------------------------

// Toggle dark mode con cookie
app.post("/toggle-darkmode", (req, res) => {
  const current = req.cookies?.darkMode === "true";
  res.cookie("darkMode", !current, { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  req.session.darkMode = !current;
  res.redirect(req.headers.referer || "/");
});

// ---------------------- RUTAS -------------------------

// Home / index
app.get("/", (req, res) => {
  if (req.session.userId) return res.redirect("/dashboard");
  res.render("index", { darkMode: req.session.darkMode || false });
});

// Login
app.get("/login", (req, res) => {
  res.render("login", { error: null, darkMode: req.session.darkMode || false });
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user)
      return res.render("login", { error: "Usuario no encontrado", darkMode: req.session.darkMode || false });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.render("login", { error: "Contraseña incorrecta", darkMode: req.session.darkMode || false });

    req.session.userId = user._id;
    req.session.username = user.username;
    user.lastLogin = new Date();
    await user.save();

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err);
    res.render("login", { error: "Error interno", darkMode: req.session.darkMode || false });
  }
});

// Register
app.get("/register", (req, res) => {
  res.render("register", { error: null, darkMode: req.session.darkMode || false });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password, passwordConfirm } = req.body;
    if (!username || !password)
      return res.render("register", { error: "Debes completar campos", darkMode: req.session.darkMode || false });
    if (password !== passwordConfirm)
      return res.render("register", { error: "Contraseñas no coinciden", darkMode: req.session.darkMode || false });

    const exists = await User.findOne({ username });
    if (exists)
      return res.render("register", { error: "Usuario ya existe", darkMode: req.session.darkMode || false });

    const hash = await bcrypt.hash(password, 10);
    const created = await User.create({ username, password: hash });

    req.session.userId = created._id;
    req.session.username = created.username;
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Register error:", err);
    res.render("register", { error: "Error registrando usuario", darkMode: req.session.darkMode || false });
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
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
    darkMode: req.session.darkMode || false,
  });
});

// Toggle dark mode
app.post("/toggle-darkmode", (req, res) => {
  req.session.darkMode = !req.session.darkMode;
  res.redirect(req.headers.referer || "/");
});

// ✅ Generate QR (create) - con https automático
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
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

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

// ✅ Update originalUrl con https automático
app.post("/update/:id", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  try {
    const { id } = req.params;
    let { originalUrl } = req.body;
    if (!originalUrl) return res.redirect("/dashboard");

    originalUrl = originalUrl.trim();
    if (!/^https?:\/\//i.test(originalUrl)) {
      originalUrl = "https://" + originalUrl;
    }

    await QR.updateOne({ id, owner: req.session.userId }, { $set: { originalUrl } });
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error actualizando QR:", err);
    res.status(500).send("Error actualizando QR");
  }
});

// Delete QR
app.post("/delete/:id", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  try {
    const { id } = req.params;
    const r = await QR.findOneAndDelete({ id, owner: req.session.userId });
    if (r) {
      await User.findByIdAndUpdate(req.session.userId, { $inc: { qrCount: -1 } });
    }
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error eliminando QR:", err);
    res.status(500).send("Error eliminando QR");
  }
});

// Change password
app.get("/change-password", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  res.render("change-password", { error: null, success: null, darkMode: req.session.darkMode || false });
});

app.post("/change-password", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword)
      return res.render("change-password", { error: "Confirmación no coincide", success: null, darkMode: req.session.darkMode || false });

    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect("/login");
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok)
      return res.render("change-password", { error: "Contraseña actual incorrecta", success: null, darkMode: req.session.darkMode || false });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.render("change-password", { error: null, success: "Contraseña actualizada", darkMode: req.session.darkMode || false });
  } catch (err) {
    console.error("Error change-password:", err);
    res.render("change-password", { error: "Error interno", success: null, darkMode: req.session.darkMode || false });
  }
});

// Delete account
app.post("/delete-account", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  try {
    const uid = req.session.userId;
    await QR.deleteMany({ owner: uid });
    await User.findByIdAndDelete(uid);
    req.session.destroy();
    res.redirect("/");
  } catch (err) {
    console.error("Error delete-account:", err);
    res.status(500).send("Error eliminando cuenta");
  }
});

// fallback
app.use((req, res) => res.status(404).send("Ruta no encontrada"));

// Start server
app.listen(PORT, () => console.log(`✅ Servidor en http://localhost:${PORT}`));
