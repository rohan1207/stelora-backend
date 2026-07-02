import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/auth.routes.js";
import brandRoutes from "./routes/brand.routes.js";
import influencerRoutes from "./routes/influencer.routes.js";
import orderRoutes from "./routes/order.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import storefrontRoutes from "./routes/storefront.routes.js";

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", platform: "Stelora Media", version: "1.0.0" });
});

app.use("/api/auth", authRoutes);
app.use("/api/brand", brandRoutes);
app.use("/api/influencer", influencerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/storefront", storefrontRoutes);

app.use(errorHandler);

app.listen(env.port, "0.0.0.0", () => {
  console.log(`Stelora Media API running on port ${env.port}`);
});
