// index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import qrcode from "qrcode";
import fetch from "node-fetch";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import User from "./models/User.js";
import QR from "./models/QR.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Check env ---
if (!process.env.MONGODB_URI) {
  console.error("ERROR: MONGODB_URI no está definida. Ponla en las variables de entorno.");
}
if (!process.env.SESSION_SECRET) {
  console.error("ERROR: SESSION_SECRET no está definida. Ponla en las variables de entorno.");
}

// --- Mongoose ---
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => {
    console.error("❌ Error conectando a MongoDB:", err.message || err);
  });

// --- App config ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// --- Helpers ---
function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.SESSION_SECRET, { expiresIn: "7d" });
}

async function shortenInternalUrl(internalUrl) {
  try {
    const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`);
    const txt = await r.text();
    if (txt && txt.startsWith("http")) return txt;
  } catch (err) {
    console.warn("Acortador falló:", err?.message || err);
  }
  return internalUrl;
}

// --- Authenticate middleware ---
const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
    if (!token) return res.redirect("/login");
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }
    req.user = user;
    next();
  } catch (err) {
    // invalid token or other issues -> redirect login
    res.clearCookie("token");
    return res.redirect("/login");
  }
};

// --- Public routes ---
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

// --- Auth routes ---
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.render("register", { error: "Completa todos los campos" });

    const existing = await User.findOne({ username });
    if (existing) return res.render("register", { error: "Usuario ya existe" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed, createdAt: new Date() });

    const token = signToken(user._id);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    return res.redirect("/");
  } catch (err) {
    console.error("Register error:", err);
    return res.render("register", { error: "Error al registrar" });
  }
});

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
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    return res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    return res.render("login", { error: "Error al iniciar sesión" });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// --- Protected routes (dashboard) ---
app.get("/", authenticate, async (req, res) => {
  try {
    const qrList = await QR.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.render("index", { qrList, currentUser: req.user.username });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error cargando dashboard");
  }
});

// Create QR
app.post("/generate", authenticate, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl) return res.redirect("/");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;
    const shortInternalUrl = await shortenInternalUrl(internalUrl);
    const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

    await QR.create({
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

// Update QR's destination without changing its short/internal url
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

// Delete QR
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

// Change password
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

// Delete account
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

// QR redirect (public)
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

// Fallback
app.use((req, res) => res.status(404).send("Not found"));

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
