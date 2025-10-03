import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import session from "express-session";
import mongoose from "mongoose";
import qrcode from "qrcode";
import fetch from "node-fetch";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

import User from "./models/User.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- CONFIG --------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || "default_secret",
  resave: false,
  saveUninitialized: false,
}));

// -------------------- MONGODB --------------------
const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      console.error("❌ MONGODB_URI no está definida.");
      return;
    }
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
  }
};
connectDB();

// -------------------- LISTA DE QRS --------------------
let qrList = [];

// -------------------- MIDDLEWARE --------------------
const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  next();
};

const getCurrentUser = async (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      res.locals.currentUser = user ? user.username : null;
    } catch {
      res.locals.currentUser = null;
    }
  } else {
    res.locals.currentUser = null;
  }
  next();
};

app.use(getCurrentUser);

// -------------------- RUTAS --------------------

// LOGIN
app.get("/login", (req, res) => res.render("login"));
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.render("login", { error: "Usuario no encontrado" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render("login", { error: "Contraseña incorrecta" });

    req.session.userId = user._id;
    user.lastLogin = new Date();
    await user.save();

    res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Error interno");
  }
});

// REGISTER
app.get("/register", (req, res) => res.render("register"));
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hash });
    await user.save();
    req.session.userId = user._id;
    res.redirect("/");
  } catch (err) {
    console.error("Register error:", err);
    res.render("register", { error: "Error al registrar. Usuario puede existir." });
  }
});

// LOGOUT
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// CHANGE PASSWORD
app.get("/change-password", requireLogin, (req, res) => res.render("change-password"));
app.post("/change-password", requireLogin, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect("/login");

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.render("change-password", { error: "Contraseña anterior incorrecta" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.render("change-password", { success: "Contraseña cambiada" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error interno");
  }
});

// DELETE USER
app.post("/delete-user", requireLogin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.session.userId);
    req.session.destroy(() => res.redirect("/register"));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error interno");
  }
});

// HOME / QR LIST
app.get("/", requireLogin, (req, res) => res.render("index", { qrList }));

// GENERAR QR
app.post("/generate", requireLogin, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl) return res.redirect("/");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

    // Acortar URL
    let shortInternalUrl;
    try {
      const response = await fetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`
      );
      shortInternalUrl = await response.text();
      if (!shortInternalUrl.startsWith("http")) shortInternalUrl = internalUrl;
    } catch {
      shortInternalUrl = internalUrl;
    }

    const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

    qrList.push({
      id,
      originalUrl,
      internalUrl,
      shortInternalUrl,
      qrDataUrl,
      scans: 0,
      lastScan: null
    });

    // Actualizar contador de QRs en usuario
    const user = await User.findById(req.session.userId);
    if (user) {
      user.qrCount += 1;
      await user.save();
    }

    res.redirect("/");
  } catch (err) {
    console.error("❌ Error generando QR:", err);
    res.status(500).send("Error generando QR");
  }
});

// ACTUALIZAR URL QR
app.post("/update/:id", requireLogin, (req, res) => {
  const qrItem = qrList.find(q => q.id === req.params.id);
  if (!qrItem) return res.status(404).send("QR no encontrado");
  qrItem.originalUrl = req.body.newUrl;
  res.redirect("/");
});

// ELIMINAR QR
app.post("/delete/:id", requireLogin, (req, res) => {
  qrList = qrList.filter(q => q.id !== req.params.id);
  res.redirect("/");
});

// REDIRECCIÓN QR
app.get("/qr/:id", (req, res) => {
  const qrItem = qrList.find(q => q.id === req.params.id);
  if (!qrItem) return res.status(404).send("QR no encontrado");
  qrItem.scans++;
  qrItem.lastScan = new Date().toLocaleString();
  res.redirect(qrItem.originalUrl);
});

// -------------------- START --------------------
app.listen(PORT, () => console.log(`🚀 Servidor en ejecución en http://localhost:${PORT}`));
