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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// Simulación usuarios
let users = [{ username: "admin", password: "1234" }];
let qrList = [];

// Página de login
app.get("/login", (req, res) => {
  res.render("login", { error: req.query.error });
});

// Autenticación
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.redirect("/login?error=Usuario o contraseña incorrecto");
  }

  req.session.user = user.username;
  res.redirect("/");
});

// Eliminar cuenta
app.post("/delete-account", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  users = users.filter(u => u.username !== req.session.user);
  req.session.destroy(() => {
    res.redirect("/login?error=Cuenta eliminada correctamente");
  });
});

// Middleware autenticación
function isAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// Página principal protegida
app.get("/", isAuth, (req, res) => {
  res.render("index", { qrList });
});

// Generar QR
app.post("/generate", isAuth, async (req, res) => {
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
  } catch (err) {
    console.error("❌ Error generando QR:", err);
    res.status(500).send("Error generando QR");
  }
});

// Actualizar URL
app.post("/update/:id", isAuth, (req, res) => {
  const { id } = req.params;
  const { newUrl } = req.body;

  const qrItem = qrList.find(q => q.id === id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.originalUrl = newUrl;
  res.redirect("/");
});

// Eliminar QR
app.post("/delete/:id", isAuth, (req, res) => {
  qrList = qrList.filter(q => q.id !== req.params.id);
  res.redirect("/");
});

// Redirigir escaneo
app.get("/qr/:id", (req, res) => {
  const qrItem = qrList.find(q => q.id === req.params.id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.scans++;
  qrItem.lastScan = new Date().toLocaleString();

  res.redirect(qrItem.originalUrl);
});

app.listen(PORT, () => console.log(`✅ Servidor en http://localhost:${PORT}`));
