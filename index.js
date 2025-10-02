import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import qrcode from "qrcode";
import fetch from "node-fetch";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Debes definir MONGODB_URI en variables de entorno");
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error("❌ Error MongoDB:", err));

// Models
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  createdAt: Date,
  lastLogin: Date,
  qrCount: { type: Number, default: 0 }
});

const qrSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  originalUrl: String,
  internalUrl: String,
  shortInternalUrl: String,
  qrDataUrl: String,
  scans: { type: Number, default: 0 },
  lastScan: Date
});

const User = mongoose.model("User", userSchema);
const QR = mongoose.model("QR", qrSchema);

// Configuración de EJS y carpeta pública
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// JWT middleware
const authenticate = async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.redirect("/login");
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.redirect("/login");
    next();
  } catch {
    return res.redirect("/login");
  }
};

// --- ROUTES ---

// Login & Register Pages
app.get("/login", (req, res) => res.render("login", { error: null }));
app.get("/register", (req, res) => res.render("register", { error: null }));

// Register
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render("register", { error: "Completa todos los campos" });

  const exists = await User.findOne({ username });
  if (exists) return res.render("register", { error: "Usuario ya existe" });

  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashed, createdAt: new Date() });
  await user.save();

  const token = jwt.sign({ id: user._id }, process.env.SESSION_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true });
  res.redirect("/");
});

// Login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.render("login", { error: "Usuario no encontrado" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.render("login", { error: "Contraseña incorrecta" });

  user.lastLogin = new Date();
  await user.save();

  const token = jwt.sign({ id: user._id }, process.env.SESSION_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true });
  res.redirect("/");
});

// Logout
app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// Home Page
app.get("/", authenticate, async (req, res) => {
  const qrList = await QR.find({ userId: req.user._id });
  res.render("index", { qrList, user: req.user });
});

// Create QR
app.post("/generate", authenticate, async (req, res) => {
  const originalUrl = req.body.url;
  if (!originalUrl) return res.redirect("/");

  const id = Date.now().toString();
  const internalUrl = `${req.protocol}://${req.get("host")}/qr/${id}`;

  let shortInternalUrl;
  try {
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(internalUrl)}`);
    shortInternalUrl = await response.text();
    if (!shortInternalUrl.startsWith("http")) shortInternalUrl = internalUrl;
  } catch {
    shortInternalUrl = internalUrl;
  }

  const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

  await QR.create({
    userId: req.user._id,
    originalUrl,
    internalUrl,
    shortInternalUrl,
    qrDataUrl
  });

  req.user.qrCount++;
  await req.user.save();

  res.redirect("/");
});

// Update QR
app.post("/update/:id", authenticate, async (req, res) => {
  const { newUrl } = req.body;
  const qr = await QR.findOne({ _id: req.params.id, userId: req.user._id });
  if (!qr) return res.status(404).send("QR no encontrado");
  qr.originalUrl = newUrl;
  await qr.save();
  res.redirect("/");
});

// Delete QR
app.post("/delete/:id", authenticate, async (req, res) => {
  const qr = await QR.findOne({ _id: req.params.id, userId: req.user._id });
  if (!qr) return res.status(404).send("QR no encontrado");
  await qr.deleteOne();
  req.user.qrCount--;
  await req.user.save();
  res.redirect("/");
});

// Change password
app.post("/change-password", authenticate, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.redirect("/");

  const match = await bcrypt.compare(oldPassword, req.user.password);
  if (!match) return res.send("Contraseña anterior incorrecta");

  req.user.password = await bcrypt.hash(newPassword, 10);
  await req.user.save();
  res.redirect("/");
});

// Delete user
app.post("/delete-account", authenticate, async (req, res) => {
  await QR.deleteMany({ userId: req.user._id });
  await req.user.deleteOne();
  res.clearCookie("token");
  res.redirect("/register");
});

// QR redirect
app.get("/qr/:id", async (req, res) => {
  const qr = await QR.findById(req.params.id);
  if (!qr) return res.status(404).send("QR no encontrado");

  qr.scans++;
  qr.lastScan = new Date();
  await qr.save();

  res.redirect(qr.originalUrl);
});

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
