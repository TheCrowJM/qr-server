import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import qrcode from "qrcode";
import fetch from "node-fetch";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración EJS y pública
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Sesiones para usuarios y dark mode
app.use(session({
  secret: "secret_key_qr_app",
  resave: false,
  saveUninitialized: false
}));

// Base de datos temporal de usuarios
let users = {}; // { username: { password, darkMode } }

// Lista temporal de QRs
let qrList = [];

// Middleware para verificar login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// Middleware para dark mode
app.use((req, res, next) => {
  res.locals.darkMode = req.session.darkMode || false;
  next();
});

// --------------------- RUTAS USUARIOS ---------------------

// Página registro
app.get("/register", (req, res) => res.render("register"));

// Registrar usuario
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect("/register");
  if (users[username]) return res.send("Usuario ya existe");

  users[username] = { password, darkMode: false };
  req.session.user = username;
  res.redirect("/");
});

// Página login
app.get("/login", (req, res) => res.render("login"));

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || user.password !== password) return res.send("Usuario o contraseña incorrecta");

  req.session.user = username;
  req.session.darkMode = user.darkMode;
  res.redirect("/");
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Página cambiar contraseña
app.get("/change-password", requireLogin, (req, res) => res.render("change-password"));

// Cambiar contraseña
app.post("/change-password", requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = users[req.session.user];
  if (user.password !== oldPassword) return res.send("Contraseña antigua incorrecta");

  user.password = newPassword;
  res.send("Contraseña cambiada correctamente");
});

// Toggle dark mode
app.post("/toggle-dark", requireLogin, (req, res) => {
  const user = users[req.session.user];
  user.darkMode = !user.darkMode;
  req.session.darkMode = user.darkMode;
  res.redirect("/");
});

// --------------------- RUTAS QR ---------------------

app.get("/", requireLogin, (req, res) => {
  res.render("index", { qrList, user: req.session.user });
});

app.post("/generate", requireLogin, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl || originalUrl.trim() === "") return res.redirect("/");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

    let shortInternalUrl;
    try {
      const resFetch = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`);
      shortInternalUrl = await resFetch.text();
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

    res.redirect("/");
  } catch {
    res.status(500).send("Error generando QR");
  }
});

app.post("/update/:id", requireLogin, (req, res) => {
  const { id } = req.params;
  const { newUrl } = req.body;
  const qrItem = qrList.find(q => q.id === id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.originalUrl = newUrl;
  res.redirect("/");
});

app.post("/delete/:id", requireLogin, (req, res) => {
  qrList = qrList.filter(q => q.id !== req.params.id);
  res.redirect("/");
});

app.get("/qr/:id", (req, res) => {
  const qrItem = qrList.find(q => q.id === req.params.id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.scans++;
  qrItem.lastScan = new Date().toLocaleString();
  res.redirect(qrItem.originalUrl);
});

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
