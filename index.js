// index.js
import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secretkey',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // si usas https cambia a true
  })
);

// Ejemplo de base de datos en memoria
const users = [];

// Ruta de registro
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  // Hash con bcryptjs
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  users.push({ username, password: hashedPassword });
  res.json({ message: 'Usuario registrado' });
});

// Ruta de login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);

  if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ error: 'Contraseña incorrecta' });

  req.session.user = user.username;
  res.json({ message: 'Login exitoso' });
});

// Ruta para generar QR
app.get('/qrcode', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });

  try {
    const qr = await QRCode.toDataURL(`Usuario: ${req.session.user}`);
    res.send(`<img src="${qr}" alt="QR Code" />`);
  } catch (err) {
    res.status(500).json({ error: 'Error generando QR' });
  }
});

// Ruta de logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Sesión cerrada' });
});

// Servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
