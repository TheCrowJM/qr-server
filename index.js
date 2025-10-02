// index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import qrcode from "qrcode";
import fetch from "node-fetch";
import session from "express-session";
import bcrypt from "bcrypt";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, "users.json");

const app = express();
const PORT = process.env.PORT || 3000;

// EJS + estáticos
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || "cambiar_por_algo_seguro",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 día
}));

// --- Helpers para users.json ---
async function loadUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    if (err.code === "ENOENT") {
      await saveUsers([]);
      return [];
    }
    console.error("Error leyendo users.json:", err);
    return [];
  }
}
async function saveUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  } catch (err) {
    console.error("Error escribiendo users.json:", err);
  }
}
async function findUser(username) {
  const users = await loadUsers();
  return users.find(u => u.username === username);
}
async function updateUser(updated) {
  const users = await loadUsers();
  const idx = users.findIndex(u => u.username === updated.username);
  if (idx !== -1) users[idx] = updated;
  else users.push(updated);
  await saveUsers(users);
}
async function removeUser(username) {
  const users = await loadUsers();
  const filtered = users.filter(u => u.username !== username);
  await saveUsers(filtered);
}

// --- QR storage (en memoria para ahora) ---
let qrList = []; // cada item: { id, owner, originalUrl, internalUrl, shortInternalUrl, qrDataUrl, scans, lastScan }

// --- Middlewares ---
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// Pasar usuario a vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// --- RUTAS USUARIOS ---
// Register form
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

// Register submit
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render("register", { error: "Completa todos los campos" });

  const users = await loadUsers();
  if (users.find(u => u.username === username)) return res.render("register", { error: "Usuario ya existe" });

  const hash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  const newUser = {
    username,
    password: hash,
    createdAt: now,
    lastLogin: null,
    qrCount: 0
  };
  users.push(newUser);
  await saveUsers(users);

  req.session.user = username;
  res.redirect("/");
});

// Login form
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// Login submit
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users = await loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.render("login", { error: "Usuario o contraseña incorrectos" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.render("login", { error: "Usuario o contraseña incorrectos" });

  // actualizar lastLogin
  user.lastLogin = new Date().toISOString();
  await updateUser(user);

  req.session.user = username;
  res.redirect("/");
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Delete account (desde sesión)
app.post("/delete-account", requireLogin, async (req, res) => {
  const username = req.session.user;
  // borrar usuario del JSON
  await removeUser(username);
  // borrar QRs del usuario
  qrList = qrList.filter(q => q.owner !== username);
  // destruir sesión
  req.session.destroy(() => res.redirect("/register"));
});

// Change password form
app.get("/change-password", requireLogin, (req, res) => {
  res.render("change-password", { error: null, success: null });
});

// Change password submit
app.post("/change-password", requireLogin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const users = await loadUsers();
  const user = users.find(u => u.username === req.session.user);
  if (!user) return res.render("change-password", { error: "Usuario no encontrado", success: null });

  const ok = await bcrypt.compare(oldPassword, user.password);
  if (!ok) return res.render("change-password", { error: "Contraseña actual incorrecta", success: null });

  const hash = await bcrypt.hash(newPassword, 10);
  user.password = hash;
  await updateUser(user);

  res.render("change-password", { error: null, success: "Contraseña actualizada correctamente" });
});

// --- Helper acortador (is.gd) ---
async function shortenInternalUrl(internalUrl) {
  try {
    const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`);
    const text = await r.text();
    if (text && text.startsWith("http")) return text;
  } catch (err) {
    console.warn("Acortador falló:", err?.message || err);
  }
  return internalUrl;
}

// --- RUTAS QR ---
// Dashboard (lista de QRs del usuario)
app.get("/", requireLogin, (req, res) => {
  const username = req.session.user;
  const userQrs = qrList.filter(q => q.owner === username);
  res.render("index", { qrList: userQrs, darkMode: false }); // darkMode aplicado desde cliente
});

// Create QR (incrementar qrCount en users.json)
app.post("/generate", requireLogin, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl || originalUrl.trim() === "") return res.redirect("/");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;
    const shortInternalUrl = await shortenInternalUrl(internalUrl);
    const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

    const username = req.session.user;

    qrList.push({
      id,
      owner: username,
      originalUrl,
      internalUrl,
      shortInternalUrl,
      qrDataUrl,
      scans: 0,
      lastScan: null
    });

    // actualizar contador en users.json
    const users = await loadUsers();
    const user = users.find(u => u.username === username);
    if (user) {
      user.qrCount = (user.qrCount || 0) + 1;
      await updateUser(user);
    }

    res.redirect("/");
  } catch (err) {
    console.error("Error generando QR:", err);
    res.status(500).send("Error generando QR");
  }
});

// Update originalUrl only (QR image remains)
app.post("/update/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const { newUrl } = req.body;
  const qr = qrList.find(q => q.id === id && q.owner === req.session.user);
  if (!qr) return res.status(404).send("QR no encontrado o sin permiso");

  qr.originalUrl = newUrl;
  // actualizar shortInternalUrl (opcional: acortar la interna de redirección)
  // dejamos el shortInternalUrl igual (es la URL que apunta al servidor), no la que redirige al destino.
  res.redirect("/");
});

// Delete QR
app.post("/delete/:id", requireLogin, async (req, res) => {
  const { id } = req.params;
  const username = req.session.user;
  const idx = qrList.findIndex(q => q.id === id && q.owner === username);
  if (idx !== -1) {
    qrList.splice(idx, 1);
    // decrementar contador usuario
    const users = await loadUsers();
    const user = users.find(u => u.username === username);
    if (user) {
      user.qrCount = Math.max(0, (user.qrCount || 1) - 1);
      await updateUser(user);
    }
  }
  res.redirect("/");
});

// QR redirect (public)
app.get("/qr/:id", (req, res) => {
  const qr = qrList.find(q => q.id === req.params.id);
  if (!qr) return res.status(404).send("QR no encontrado");

  qr.scans++;
  qr.lastScan = new Date().toLocaleString();
  res.redirect(qr.originalUrl);
});

// Start server
app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
