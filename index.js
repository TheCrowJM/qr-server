import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import bcrypt from "bcrypt";
import QRCode from "qrcode";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// Sesión
app.use(
  session({
    secret: "supersecreto",
    resave: false,
    saveUninitialized: false,
  })
);

// Simulación de usuarios en memoria
let users = [{ username: "admin", password: await bcrypt.hash("1234", 10) }];
let qrList = [];

// Middleware de autenticación
function checkAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login");
}

// ====== RUTAS ======
app.get("/", checkAuth, (req, res) => {
  res.render("index", { qrList, user: req.session.user });
});

// -------- LOGIN --------
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = users.find((u) => u.username === username);

  if (user && (await bcrypt.compare(password, user.password))) {
    req.session.user = username;
    res.redirect("/");
  } else {
    res.render("login", { error: "Nombre de usuario o contraseña incorrecto" });
  }
});

// -------- REGISTER --------
app.get("/register", (req, res) => {
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (users.find((u) => u.username === username)) {
    return res.render("register", { error: "Usuario ya existe" });
  }
  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed });
  res.redirect("/login");
});

// -------- LOGOUT --------
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// -------- ELIMINAR USUARIO --------
app.post("/delete-user", checkAuth, (req, res) => {
  users = users.filter((u) => u.username !== req.session.user);
  req.session.destroy(() => res.redirect("/login"));
});

// -------- CAMBIAR CONTRASEÑA --------
app.post("/change-password", checkAuth, async (req, res) => {
  const { newPassword } = req.body;
  users = users.map((u) =>
    u.username === req.session.user
      ? { ...u, password: await bcrypt.hash(newPassword, 10) }
      : u
  );
  res.redirect("/");
});

// -------- CREAR QR --------
app.post("/generate", checkAuth, async (req, res) => {
  const { text } = req.body;
  const qr = await QRCode.toDataURL(text);
  qrList.push({ text, qr });
  res.redirect("/");
});

// -------- ACTUALIZAR URL --------
app.post("/update/:index", checkAuth, async (req, res) => {
  const { index } = req.params;
  const { newText } = req.body;
  if (qrList[index]) {
    qrList[index].text = newText;
  }
  res.redirect("/");
});

// -------- ELIMINAR QR --------
app.post("/delete/:index", checkAuth, (req, res) => {
  const { index } = req.params;
  qrList.splice(index, 1);
  res.redirect("/");
});

app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));
