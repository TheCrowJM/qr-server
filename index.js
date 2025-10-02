import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import qrcode from "qrcode";
import fetch from "node-fetch";
import mongoose from "mongoose";
import session from "express-session";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Conexión a MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI no está definida. Ponla en las variables de entorno.");
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ Conectado a MongoDB"))
  .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// Configuración de sesión
app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false
}));

// Configuración de EJS y carpeta pública
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Modelo de Usuario
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date,
  qrCount: { type: Number, default: 0 }
});
const User = mongoose.model("User", userSchema);

// Lista temporal de QRs
let qrList = [];

// Middleware para proteger rutas
function authMiddleware(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// Rutas de autenticación
app.get("/login", (req, res) => res.render("login", { darkMode: false }));
app.get("/register", (req, res) => res.render("register", { darkMode: false }));

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.redirect("/register");

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    req.session.userId = user._id;
    res.redirect("/");
  } catch (err) {
    console.error("❌ Error al registrar usuario:", err);
    res.status(500).send("Error al registrar usuario");
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.redirect("/login");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect("/login");

    req.session.userId = user._id;
    user.lastLogin = new Date();
    await user.save();

    res.redirect("/");
  } catch (err) {
    console.error("❌ Error al iniciar sesión:", err);
    res.status(500).send("Error al iniciar sesión");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Página principal protegida
app.get("/", authMiddleware, (req, res) => {
  res.render("index", { qrList, darkMode: false });
});

// Crear un nuevo QR
app.post("/generate", authMiddleware, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl || originalUrl.trim() === "") return res.redirect("/");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

    let shortInternalUrl;
    try {
      const resFetch = await fetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`
      );
      shortInternalUrl = await resFetch.text();
      if (!shortInternalUrl.startsWith("http")) shortInternalUrl = internalUrl;
    } catch (err) {
      console.error("Error acortando URL, se usará la URL interna", err);
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

    // Incrementar contador de QRs en el usuario
    const user = await User.findById(req.session.userId);
    user.qrCount = (user.qrCount || 0) + 1;
    await user.save();

    res.redirect("/");
  } catch (err) {
    console.error("❌ Error generando QR:", err);
    res.status(500).send("Error generando QR");
  }
});

// Actualizar solo la URL de destino
app.post("/update/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const { newUrl } = req.body;

  const qrItem = qrList.find(q => q.id === id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.originalUrl = newUrl;
  res.redirect("/");
});

// Eliminar QR
app.post("/delete/:id", authMiddleware, (req, res) => {
  qrList = qrList.filter(q => q.id !== req.params.id);
  res.redirect("/");
});

// Redirección al escanear el QR
app.get("/qr/:id", (req, res) => {
  const qrItem = qrList.find(q => q.id === req.params.id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.scans++;
  qrItem.lastScan = new Date().toLocaleString();

  res.redirect(qrItem.originalUrl);
});

// Cambiar contraseña
app.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.session.userId);

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.send("Contraseña actual incorrecta");

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error cambiando contraseña");
  }
});

// Eliminar cuenta
app.post("/delete-account", authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.session.userId);
    req.session.destroy();
    res.redirect("/register");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error eliminando usuario");
  }
});

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
