import mongoose from "mongoose";

const qrSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  id: { type: String, required: true, unique: true },
  originalUrl: { type: String, required: true },
  internalUrl: { type: String, required: true },
  shortInternalUrl: { type: String, required: true },
  qrDataUrl: { type: String, required: true },
  scans: { type: Number, default: 0 },
  lastScan: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.QR || mongoose.model("QR", qrSchema);

