import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "./middleware/auth.js";
import ticketRoutes from "./routes/tickets.js";
import knowledgeRoutes from "./routes/knowledge.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "../uploads"));
fs.mkdirSync(uploadDir, { recursive: true });
app.use(helmet());
app.use(
  cors({
    origin: (process.env.CLIENT_ORIGIN || "http://localhost:3000").split(","),
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/tickets", requireAuth, ticketRoutes);
app.use("/api/knowledge", requireAuth, knowledgeRoutes);
app.use((err, _req, res, _next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.status ? err.message : "Internal server error" });
});
const port = process.env.PORT || 4000;
await mongoose.connect(process.env.MONGODB_URI);

app.listen(port, () => console.log(`Support API listening on :${port}`));
