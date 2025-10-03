import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import User from "./models/User.js";
import QR from "./models/QR.js";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB conectado"))
.catch(err => console.error("MongoDB error:", err));

// Middlewares
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: process.env.SESSION_SECRET || "secretkey",
  resave: false,
  saveUninitialized: false,
}));

// Middleware para pasar currentUser a las vistas
app.use(async (req, res, next) => {
  if (req.session.userId) {
    const user = await User.findById(req.session.userId);
    res.locals.currentUser = user?.username || null;
  } else {
    res.locals.currentUser = null;
  }
  next();
});

// Rutas
app.get("/", async (req, res) => {
  const qrs = await QR.find({}).limit(10); // ejemplo
  res.render("index", { qrs }); // currentUser ya está en res.locals
});

app.get("/login", (req, res) => res.render("login"));
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.send("Usuario no encontrado");
  
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Contraseña incorrecta");

  req.session.userId = user._id;
  res.redirect("/");
});

app.get("/register", (req, res) => res.render("register"));
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hash });
  await user.save();
  req.session.userId = user._id;
  res.redirect("/");
});

app.get("/change-password", (req, res) => res.render("change-password"));
app.post("/change-password", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const { oldPassword, newPassword } = req.body;
  const user = await User.findById(req.session.userId);
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.send("Contraseña actual incorrecta");
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.send("Contraseña cambiada");
});

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    res.redirect("/");
  });
});

app.post("/delete-account", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  await User.findByIdAndDelete(req.session.userId);
  await QR.deleteMany({ owner: req.session.userId });
  req.session.destroy(err => {
    res.redirect("/");
  });
});

// Inicio del servidor
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
