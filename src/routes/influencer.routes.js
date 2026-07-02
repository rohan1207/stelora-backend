import { Router } from "express";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole, requireVerified } from "../middleware/auth.js";
import { generateCouponCode } from "../services/couponEngine.js";

const router = Router();

router.get("/catalog", authMiddleware, requireRole("INFLUENCER"), async (req, res, next) => {
  try {
    const { niche, search } = req.query;
    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        ...(niche && { brand: { niche: { contains: niche, mode: "insensitive" } } }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { brand: { companyName: { contains: search, mode: "insensitive" } } },
          ],
        }),
      },
      include: {
        brand: true,
        _count: { select: { couponCodes: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

router.use(authMiddleware, requireRole("INFLUENCER"));

router.get("/dashboard", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const codes = await prisma.couponCode.findMany({
      where: { influencerId: influencer.id },
      include: { product: { include: { brand: true } }, orders: { where: { status: "CONFIRMED" } } },
    });

    const totalEarnings = codes.reduce(
      (sum, c) =>
        sum +
        c.orders.reduce(
          (s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)),
          0
        ),
      0
    );
    const totalUses = codes.reduce((sum, c) => sum + c.usageCount, 0);
    const pendingBalance = codes.reduce(
      (sum, c) =>
        sum +
        c.orders
          .filter((o) => o.payoutStatus === "HELD")
          .reduce((s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)), 0),
      0
    );

    res.json({
      stats: { totalCodes: codes.length, totalUses, totalEarnings, pendingBalance },
      topCodes: codes
        .map((c) => ({
          ...c,
          earnings: c.orders.reduce(
            (s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)),
            0
          ),
        }))
        .sort((a, b) => b.earnings - a.earnings)
        .slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/partnerships", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const partnerships = await prisma.partnership.findMany({
      where: { influencerId: influencer.id },
      include: { product: { include: { brand: true } } },
      orderBy: { appliedAt: "desc" },
    });
    res.json({ partnerships });
  } catch (err) {
    next(err);
  }
});

router.post("/partnerships", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const { productId } = z.object({ productId: z.string() }).parse(req.body);

    const product = await prisma.product.findUnique({
      where: { id: productId, status: "ACTIVE" },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (product.campaignMode === "OPEN") {
      return res.status(400).json({ error: "This product does not require an application" });
    }

    const existing = await prisma.partnership.findUnique({
      where: { influencerId_productId: { influencerId: influencer.id, productId } },
    });
    if (existing) return res.status(409).json({ error: "Application already exists" });

    const partnership = await prisma.partnership.create({
      data: {
        influencerId: influencer.id,
        productId,
        status: "PENDING",
      },
      include: { product: { include: { brand: true } } },
    });
    res.status(201).json({ partnership });
  } catch (err) {
    next(err);
  }
});

router.get("/codes", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const codes = await prisma.couponCode.findMany({
      where: { influencerId: influencer.id },
      include: {
        product: { include: { brand: true } },
        orders: { where: { status: "CONFIRMED" } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      codes: codes.map((c) => ({
        ...c,
        earnings: c.orders.reduce(
          (s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)),
          0
        ),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/codes/generate", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const { productId } = z.object({ productId: z.string() }).parse(req.body);

    const product = await prisma.product.findUnique({
      where: { id: productId, status: "ACTIVE" },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    if (product.campaignMode === "APPROVAL") {
      const approved = await prisma.partnership.findFirst({
        where: {
          influencerId: influencer.id,
          productId,
          status: { in: ["APPROVED", "ACTIVE"] },
        },
      });
      if (!approved) {
        return res.status(403).json({ error: "Brand approval required before generating a code" });
      }
    }

    const existing = await prisma.couponCode.findUnique({
      where: { influencerId_productId: { influencerId: influencer.id, productId } },
    });
    if (existing) return res.json({ coupon: existing });

    let code = generateCouponCode(influencer.displayName, product.name);
    let attempts = 0;
    while (attempts < 5) {
      const taken = await prisma.couponCode.findUnique({ where: { code } });
      if (!taken) break;
      code = generateCouponCode(influencer.displayName, product.name);
      attempts++;
    }

    const coupon = await prisma.couponCode.create({
      data: {
        influencerId: influencer.id,
        productId,
        code,
      },
      include: { product: { include: { brand: true } } },
    });

    if (product.campaignMode === "APPROVAL") {
      await prisma.partnership.updateMany({
        where: { influencerId: influencer.id, productId, status: "APPROVED" },
        data: { status: "ACTIVE" },
      });
    }

    res.status(201).json({ coupon });
  } catch (err) {
    next(err);
  }
});

router.get("/earnings", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const orders = await prisma.order.findMany({
      where: {
        couponCode: { influencerId: influencer.id },
        status: "CONFIRMED",
      },
      include: { product: { include: { brand: true } }, couponCode: true },
      orderBy: { createdAt: "desc" },
    });

    const total = orders.reduce(
      (s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)),
      0
    );
    const pending = orders
      .filter((o) => o.payoutStatus === "HELD")
      .reduce((s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)), 0);
    const released = orders
      .filter((o) => o.payoutStatus === "RELEASED")
      .reduce((s, o) => s + (Number(o.commissionAmount) - Number(o.platformFee)), 0);

    res.json({ summary: { total, pending, released }, orders });
  } catch (err) {
    next(err);
  }
});

router.patch("/profile", requireVerified, async (req, res, next) => {
  try {
    const schema = z.object({
      displayName: z.string().min(2).optional(),
      bio: z.string().optional(),
      instagramHandle: z.string().optional(),
      followerCount: z.number().int().min(0).optional(),
      niche: z.string().optional(),
      avatarUrl: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const profile = await prisma.influencerProfile.update({
      where: { userId: req.user.id },
      data,
    });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

export default router;
