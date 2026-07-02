import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import prisma from "../utils/prisma.js";

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, env.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { brandProfile: true, influencerProfile: true },
    });
    if (!user) return res.status(401).json({ error: "User not found" });
    if (user.status === "SUSPENDED") return res.status(403).json({ error: "Account suspended" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export function requireVerified(req, res, next) {
  if (req.user.status !== "VERIFIED" && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Account pending verification" });
  }
  next();
}
