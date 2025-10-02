// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
  lastLogin: { type: Date, default: null },
  qrCount: { type: Number, default: 0 }
});

export default mongoose.models.User || mongoose.model("User", userSchema);
