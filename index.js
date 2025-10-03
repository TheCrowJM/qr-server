// index.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import qrcode from "qrcode";
import fetch from "node-fetch";

import User from "./models/User.js";
import QR from "./models/QR.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.MONGODB_URI) console.error("❌ ERROR: MONGODB_URI no está definida.");
if (!process.env.SESSION_SECRET && !process.env.JWT_SECRET) console.error("❌ ERROR: SESSION_SECRET / JWT_SECRET no están definidas.");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// Connect to MongoDB (await-like handling)
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => {
    console.error("❌ Error conectando a MongoDB:", err);
    // do not exit here in dev; but in production you may want process.exit(1)
  });

// Helper: sign token
function signToken(userId) {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "change_this";
  return jwt.sign({ id: userId }, secret, { expiresIn: "7d" });
}

// Helper: shorten internal url (is.gd)
async function shorten(internalUrl) {
  try {
    const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`);
    const txt = await r.text();
    if (txt && txt.startsWith("http")) return txt;
  } catch (e) {
    console.warn("Acortador fallo:", e?.message || e);
  }
  return internalUrl;
}

// Auth middleware (checks cookie token)
async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
    if (!token) return res.redirect("/login");
    const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "change_this";
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id);
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }
    req.user = user;
    res.locals.currentUser = user.username;
    next();
  } catch (err) {
    res.clearCookie("token");
    return res.redirect("/login");
  }
}

/* ----------------- ROUTES ----------------- */

// public pages
app.get("/login", (req, res) => res.render("login", { error: null }));
app.get("/register", (req, res) => res.render("register", { error: null }));

// register
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.render("register", { error: "Completa todos los campos" });

    const existing = await User.findOne({ username });
    if (existing) return res.render("register", { error: "Usuario ya existe" });

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hash });
    await user.save();

    // sign token and set cookie
    const token = signToken(user._id);
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });

    user.lastLogin = new Date();
    await user.save();

    return res.redirect("/");
  } catch (err) {
    console.error("Register error:", err);
    return res.render("register", { error: "Error al registrar usuario" });
  }
});

// login
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.render("login", { error: "Completa todos los campos" });

    const user = await User.findOne({ username });
    if (!user) return res.render("login", { error: "Usuario o contraseña incorrectos" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.render("login", { error: "Usuario o contraseña incorrectos" });

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id);
    res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });

    return res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    return res.render("login", { error: "Error al iniciar sesión" });
  }
});

// logout
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// dashboard
app.get("/", authenticate, async (req, res) => {
  try {
    const qrs = await QR.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.render("index", { qrList: qrs, currentUser: req.user.username, user: req.user });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).send("Error cargando dashboard");
  }
});

// generate QR
app.post("/generate", authenticate, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl) return res.redirect("/");

    const id = Date.now().toString() + "-" + Math.random().toString(36).slice(2,8);
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;
    const shortInternalUrl = await shorten(internalUrl);
    const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

    const newQR = await QR.create({
      userId: req.user._id,
      originalUrl,
      internalUrl,
      shortInternalUrl,
      qrDataUrl
    });

    req.user.qrCount = (req.user.qrCount || 0) + 1;
    await req.user.save();

    return res.redirect("/");
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).send("Error generando QR");
  }
});

// update URL (keeps same QR)
app.post("/update/:id", authenticate, async (req, res) => {
  try {
    const qr = await QR.findOne({ _id: req.params.id, userId: req.user._id });
    if (!qr) return res.status(404).send("QR no encontrado");
    qr.originalUrl = req.body.newUrl;
    await qr.save();
    return res.redirect("/");
  } catch (err) {
    console.error("Update error:", err);
    return res.status(500).send("Error actualizando QR");
  }
});

// delete QR
app.post("/delete/:id", authenticate, async (req, res) => {
  try {
    const qr = await QR.findOne({ _id: req.params.id, userId: req.user._id });
    if (!qr) return res.status(404).send("QR no encontrado");
    await qr.deleteOne();
    req.user.qrCount = Math.max(0, (req.user.qrCount || 1) - 1);
    await req.user.save();
    return res.redirect("/");
  } catch (err) {
    console.error("Delete error:", err);
    return res.status(500).send("Error eliminando QR");
  }
});

// change password
app.get("/change-password", authenticate, (req, res) => {
  res.render("change-password", { error: null, success: null });
});
app.post("/change-password", authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const ok = await bcrypt.compare(oldPassword, req.user.password);
    if (!ok) return res.render("change-password", { error: "Contraseña actual incorrecta", success: null });
    req.user.password = await bcrypt.hash(newPassword, 10);
    await req.user.save();
    return res.render("change-password", { error: null, success: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error("Change-password error:", err);
    return res.render("change-password", { error: "Error actualizando contraseña", success: null });
  }
});

// delete account
app.post("/delete-account", authenticate, async (req, res) => {
  try {
    await QR.deleteMany({ userId: req.user._id });
    await User.deleteOne({ _id: req.user._id });
    res.clearCookie("token");
    return res.redirect("/register");
  } catch (err) {
    console.error("Delete-account error:", err);
    return res.status(500).send("Error eliminando cuenta");
  }
});

// qr redirect (public)
app.get("/qr/:id", async (req, res) => {
  try {
    const qr = await QR.findById(req.params.id);
    if (!qr) return res.status(404).send("QR no encontrado");
    qr.scans++;
    qr.lastScan = new Date();
    await qr.save();
    return res.redirect(qr.originalUrl);
  } catch (err) {
    console.error("QR redirect error:", err);
    return res.status(500).send("Error redirigiendo");
  }
});

// fallback
app.use((req, res) => res.status(404).send("Not found"));

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
