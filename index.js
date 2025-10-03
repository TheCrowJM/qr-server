// index.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import session from 'express-session';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';

import User from './models/User.js';
import QR from './models/QR.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB conectado'))
  .catch((err) => console.log('Error MongoDB:', err));

// Middleware global para user
app.use((req, res, next) => {
  res.locals.user = req.session.userId;
  next();
});

// Rutas GET
app.get('/', (req, res) => res.render('index'));
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
app.get('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('change-password');
});
app.get('/qrcode', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const qrs = await QR.find({ owner: req.session.userId });
  res.render('qrcode', { qrs });
});

// Rutas POST
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect('/register');

  const existingUser = await User.findOne({ username });
  if (existingUser) return res.redirect('/register');

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashedPassword });
  await user.save();
  req.session.userId = user._id;
  res.redirect('/');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.redirect('/login');

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.redirect('/login');

  user.lastLogin = new Date();
  await user.save();

  req.session.userId = user._id;
  res.redirect('/');
});

app.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { oldPassword, newPassword } = req.body;
  const user = await User.findById(req.session.userId);

  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return res.redirect('/change-password');

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.redirect('/');
});

// Servir archivos estáticos si los hay
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
