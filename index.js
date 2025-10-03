import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import session from "express-session";
import path from "path";
import User from "./models/User.js";
import QR from "./models/QR.js";
import qrcode from "qrcode";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const __dirname = path.resolve();

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// Configuración de vistas y carpeta pública
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Conexión a MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
    });
    console.log("✅ Conectado a MongoDB Atlas");
  } catch (err) {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  }
};

// Middleware para proteger rutas
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect("/login");
  next();
};

// -------------------------------------------
// RUTAS DE USUARIO
// -------------------------------------------

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const existing = await User.findOne({ username });
    if (existing) return res.render("register", { error: "Usuario ya existe" });

    const user = new User({ username, password });
    await user.save();
    res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).send("Error interno del servidor");
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username, password });
    if (!user) return res.render("login", { error: "Credenciales incorrectas" });

    user.lastLogin = new Date();
    await user.save();

    req.session.user = user;
    res.redirect("/index");
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Error interno del servidor");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

app.get("/change-password", requireAuth, (req, res) => {
  res.render("change-password");
});

app.post("/change-password", requireAuth, async (req, res) => {
  const { newPassword } = req.body;
  try {
    const user = await User.findById(req.session.user._id);
    user.password = newPassword;
    await user.save();
    res.redirect("/index");
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).send("Error interno del servidor");
  }
});

app.post("/delete-user", requireAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.session.user._id);
    req.session.destroy();
    res.redirect("/register");
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).send("Error interno del servidor");
  }
});

// -------------------------------------------
// RUTAS DE QR
// -------------------------------------------

app.get("/index", requireAuth, async (req, res) => {
  try {
    const qrList = await QR.find({ owner: req.session.user._id });
    res.render("index", { currentUser: req.session.user.username, qrList });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error cargando QRs");
  }
});

app.post("/generate", requireAuth, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl) return res.redirect("/index");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

    // Acortar URL con is.gd
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

    const qr = new QR({
      owner: req.session.user._id,
      id,
      originalUrl,
      internalUrl,
      shortInternalUrl,
      qrDataUrl,
    });
    await qr.save();

    await User.findByIdAndUpdate(req.session.user._id, { $inc: { qrCount: 1 } });

    res.redirect("/index");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generando QR");
  }
});

// Redirección de QR
app.get("/qr/:id", async (req, res) => {
  const qr = await QR.findOne({ id: req.params.id });
  if (!qr) return res.status(404).send("QR no encontrado");

  qr.scans++;
  qr.lastScan = new Date();
  await qr.save();

  res.redirect(qr.originalUrl);
});

// -------------------------------------------
// INICIAR SERVIDOR
// -------------------------------------------
connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));
});
