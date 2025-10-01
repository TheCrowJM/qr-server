import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import qrcode from "qrcode";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de EJS y carpeta pública
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

// Lista temporal de QRs
let qrList = [];

// Página principal
app.get("/", (req, res) => {
  res.render("index", { qrList });
});

// Crear un nuevo QR
app.post("/generate", async (req, res) => {
  try {
    const originalUrl = req.body.url;
    if (!originalUrl || originalUrl.trim() === "") return res.redirect("/");

    // Generar un ID único
    const id = Date.now().toString();

    // URL interna de redirección
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

    // Generar QR con la URL acortada
    const qrDataUrl = await qrcode.toDataURL(shortInternalUrl);

    // Guardar el QR
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
app.post("/update/:id", (req, res) => {
  const { id } = req.params;
  const { newUrl } = req.body;

  const qrItem = qrList.find(q => q.id === id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  qrItem.originalUrl = newUrl;

  res.redirect("/");
});

// Eliminar QR
app.post("/delete/:id", (req, res) => {
  qrList = qrList.filter(q => q.id !== req.params.id);
  res.redirect("/");
});

// Redirección al escanear el QR
app.get("/qr/:id", (req, res) => {
  const qrItem = qrList.find(q => q.id === req.params.id);
  if (!qrItem) return res.status(404).send("QR no encontrado");

  // Incrementar contador y fecha
  qrItem.scans++;
  qrItem.lastScan = new Date().toLocaleString();

  res.redirect(qrItem.originalUrl);
});

app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
