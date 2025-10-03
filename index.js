// index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

const User = require('./models/User');
const QR = require('./models/QR');

const app = express();

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
  })
);

// Views
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Conexión a MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB conectado'))
  .catch((err) => console.log('Error MongoDB:', err));

// Middleware para pasar info de usuario a todas las vistas
app.use((req, res, next) => {
  res.locals.user = req.session.userId;
  next();
});

// Rutas

// Página principal
app.get('/', (req, res) => {
  res.render('index'); // Renderiza views/index.ejs
});

// Registro
app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await User.create({ username, password: hashedPassword });
    req.session.userId = user._id;
    res.redirect('/');
  } catch (err) {
    res.send('Error al registrar: ' + err.message);
  }
});

// Login
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.send('Usuario no encontrado');

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send('Contraseña incorrecta');

  req.session.userId = user._id;
  res.redirect('/');
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// QR
app.get('/qrcode', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');

  const qrs = await QR.find({ user: req.session.userId });
  res.render('qrcode', { qrs });
});

// Cambiar contraseña
app.get('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('change-password');
});

app.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.session.userId);
  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.send('Contraseña actual incorrecta');

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.send('Contraseña cambiada con éxito');
});

// Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
