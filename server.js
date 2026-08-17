import 'dotenv/config';
console.log("Server file loaded");

console.log("Server file loaded");
import express from "express";
import http from "http";
import cors from "cors";
import connectDB from "./config/db.js";
import { initSocket } from "./socket.js";

import userRoutes from "./routes/user.routes.js";
import adRoutes from "./routes/ad.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import jobRoutes from "./routes/job.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";


connectDB();

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});
// Global request logger
app.use((req, res, next) => {
	console.log(`[${req.method}] ${req.originalUrl} - Body:`, req.body);
	next();
});


app.use("/api/users", userRoutes);
app.use("/api/ads", adRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/jobs", jobRoutes);

initSocket(server);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
