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

// Configuración de EJS y carpeta pública
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración de sesión
app.use(session({
  secret: 'qr-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Lista temporal de usuarios
let users = [];
// Lista temporal de QRs
let qrList = [];

// Middleware para verificar sesión
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// ------------------- LOGIN / REGISTER -------------------

// Mostrar login
app.get("/login", (req, res) => {
  res.render("login", { darkMode: req.session.darkMode || false, user: req.session.user });
});

// Procesar login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    req.session.user = user;
    req.session.darkMode = user.darkMode || false;
    res.redirect("/");
  } else {
    res.send("Usuario o contraseña incorrectos");
  }
});

// Mostrar registro
app.get("/register", (req, res) => {
  res.render("register");
});

// Procesar registro
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (users.find(u => u.username === username)) return res.send("Usuario ya existe");
  users.push({ username, password, darkMode: false });
  res.redirect("/login");
});

// Cambiar contraseña
app.get("/change-password", requireLogin, (req, res) => {
  res.render("change-password", { darkMode: req.session.darkMode });
});

app.post("/change-password", requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (req.session.user.password !== oldPassword) return res.send("Contraseña actual incorrecta");
  req.session.user.password = newPassword;
  res.send("Contraseña actualizada correctamente. <a href='/'>Volver</a>");
});

// Toggle dark mode
app.post("/toggle-dark", requireLogin, (req, res) => {
  req.session.darkMode = !req.session.darkMode;
  req.session.user.darkMode = req.session.darkMode;
  res.redirect("back");
});

// Eliminar cuenta
app.post("/delete-account", requireLogin, (req, res) => {
  users = users.filter(u => u.username !== req.session.user.username);
  req.session.destroy(err => {
    if (err) return res.status(500).send("Error al eliminar cuenta");
    res.redirect("/register");
  });
});

// ------------------- QR -------------------

// Página principal
app.get("/", requireLogin, (req, res) => {
  res.render("index", { qrList, darkMode: req.session.darkMode });
});

// Crear un nuevo QR
app.post("/generate", requireLogin, async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl || originalUrl.trim() === "") return res.redirect("/");

    const id = Date.now().toString();
    const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

    // Acortar la URL interna usando is.gd
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

    res.redirect("/");
  } catch (err) {
    console.error("❌ Error generando QR:", err);
    res.status(500).send("Error generando QR");
  }
});

// Actualizar solo la URL de destino (QR no cambia)
app.post("/update/:id", requireLogin, (req, res) => {
  const { id } = req.params;
  const { newUrl } = req.body;

  const qrItem = qrList.find(q => q.id === id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.originalUrl = newUrl;
  res.redirect("/");
});

// Eliminar QR
app.post("/delete/:id", requireLogin, (req, res) => {
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

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
