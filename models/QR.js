import mongoose from "mongoose";

const qrSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  id: { type: String, required: true },
  originalUrl: { type: String, required: true },
  internalUrl: { type: String, required: true },
  shortInternalUrl: { type: String, required: true },
  qrDataUrl: { type: String, required: true },
  scans: { type: Number, default: 0 },
  lastScan: { type: Date },
});

export default mongoose.models.QR || mongoose.model("QR", qrSchema);



