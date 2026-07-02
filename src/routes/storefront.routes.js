import { Router } from "express";
import prisma from "../utils/prisma.js";

const router = Router();

router.get("/:username", async (req, res, next) => {
  try {
    const influencer = await prisma.influencerProfile.findUnique({
      where: { username: req.params.username.toLowerCase() },
      include: {
        couponCodes: {
          where: { isActive: true },
          include: {
            product: {
              include: { brand: true },
            },
          },
        },
      },
    });
    if (!influencer) return res.status(404).json({ error: "Creator not found" });

    res.json({
      creator: {
        displayName: influencer.displayName,
        username: influencer.username,
        bio: influencer.bio,
        avatarUrl: influencer.avatarUrl,
        niche: influencer.niche,
        instagramHandle: influencer.instagramHandle,
      },
      products: influencer.couponCodes.map((c) => ({
        code: c.code,
        product: c.product,
        usageCount: c.usageCount,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
