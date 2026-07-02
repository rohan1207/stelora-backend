import "dotenv/config";

export const env = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT) || 10,
  payoutHoldDays: Number(process.env.PAYOUT_HOLD_DAYS) || 14,
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((o) => o.trim()),
};
