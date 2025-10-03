import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import QRCode from "qrcode";

import User from "./models/User.js";
import QR from "./models/QR.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Conexión a MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000
  })
  .then(() => console.log("✅ Conectado a MongoDB Atlas"))
  .catch((err) => console.error("❌ Error de conexión a MongoDB:", err));

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// Configuración de vistas
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Ruta principal
app.get("/", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  res.render("index");
});

// Registro
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({ username, password: hashedPassword });
    await user.save();

    res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).send("Error al registrar el usuario.");
  }
});

// Login
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.status(401).send("Usuario no encontrado.");

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(401).send("Contraseña incorrecta.");

  user.lastLogin = new Date();
  await user.save();

  req.session.userId = user._id;
  res.redirect("/");
});

// Cerrar sesión
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Crear QR
app.post("/generate", async (req, res) => {
  try {
    const { url } = req.body;
    const qrDataUrl = await QRCode.toDataURL(url);

    const newQR = new QR({
      owner: req.session.userId,
      id: Date.now().toString(),
      originalUrl: url,
      internalUrl: `/qr/${Date.now()}`,
      shortInternalUrl: `/s/${Date.now()}`,
      qrDataUrl,
    });

    await newQR.save();

    const user = await User.findById(req.session.userId);
    user.qrCount += 1;
    await user.save();

    res.render("index", { qr: newQR });
  } catch (err) {
    console.error("QR Generation error:", err);
    res.status(500).send("Error al generar el código QR.");
  }
});

// Ruta favicon (para evitar 500)
app.get("/favicon.ico", (req, res) => res.status(204));

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});
