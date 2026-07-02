import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { signToken } from "../utils/token.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["BRAND", "INFLUENCER"]),
  companyName: z.string().min(2).optional(),
  displayName: z.string().min(2).optional(),
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/).optional(),
  niche: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function formatUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    brandProfile: user.brandProfile || null,
    influencerProfile: user.influencerProfile || null,
  };
}

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    if (data.role === "BRAND" && !data.companyName) {
      return res.status(400).json({ error: "Company name is required for brands" });
    }
    if (data.role === "INFLUENCER" && (!data.displayName || !data.username)) {
      return res.status(400).json({ error: "Display name and username are required for influencers" });
    }

    if (data.username) {
      const taken = await prisma.influencerProfile.findUnique({ where: { username: data.username } });
      if (taken) return res.status(409).json({ error: "Username already taken" });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        role: data.role,
        status: "PENDING",
        ...(data.role === "BRAND" && {
          brandProfile: {
            create: {
              companyName: data.companyName,
              niche: data.niche || null,
            },
          },
        }),
        ...(data.role === "INFLUENCER" && {
          influencerProfile: {
            create: {
              displayName: data.displayName,
              username: data.username,
              niche: data.niche || null,
            },
          },
        }),
      },
      include: { brandProfile: true, influencerProfile: true },
    });

    const token = signToken({ userId: user.id, role: user.role });
    res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { brandProfile: true, influencerProfile: true },
    });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken({ userId: user.id, role: user.role });
    res.json({ token, user: formatUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  res.json({ user: formatUser(req.user) });
});

export default router;
