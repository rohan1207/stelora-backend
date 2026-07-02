import { Router } from "express";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole, requireVerified } from "../middleware/auth.js";
import { generateCouponCode } from "../services/couponEngine.js";
import { buildCreatorSnapshot } from "../services/orderEngine.js";
import { fetchInstagramProfile, checkEligibility, syncInstagramForUser } from "../services/instagramService.js";

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
      include: {
        product: { include: { brand: true } },
        couponCode: true,
      },
      orderBy: { appliedAt: "desc" },
    });

    const enriched = partnerships.map((p) => ({
      ...p,
      daysLeft: p.contentDeadline
        ? Math.max(0, Math.ceil((new Date(p.contentDeadline) - Date.now()) / (1000 * 60 * 60 * 24)))
        : null,
    }));

    res.json({ partnerships: enriched });
  } catch (err) {
    next(err);
  }
});

router.post("/partnerships", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const schema = z.object({
      productId: z.string(),
      message: z.string().min(10).max(1000),
    });
    const { productId, message } = schema.parse(req.body);

    const eligibility = checkEligibility({
      followerCount: influencer.followerCount,
      engagementRate: influencer.engagementRate ? Number(influencer.engagementRate) : null,
    });
    if (!eligibility.eligible) {
      return res.status(403).json({
        error: "You do not meet eligibility requirements",
        issues: eligibility.issues,
      });
    }

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
        applicationMessage: message,
        creatorSnapshot: buildCreatorSnapshot(influencer),
      },
      include: { product: { include: { brand: true } } },
    });
    res.status(201).json({ partnership });
  } catch (err) {
    next(err);
  }
});

router.patch("/partnerships/:id/content-submitted", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const partnership = await prisma.partnership.findFirst({
      where: {
        id: req.params.id,
        influencerId: influencer.id,
        status: { in: ["APPROVED", "ACTIVE"] },
      },
    });
    if (!partnership) return res.status(404).json({ error: "Partnership not found" });

    const updated = await prisma.partnership.update({
      where: { id: partnership.id },
      data: { contentSubmittedAt: new Date() },
      include: { product: { include: { brand: true } } },
    });
    res.json({ partnership: updated });
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

    let partnership = null;
    if (product.campaignMode === "APPROVAL" || product.campaignMode === "INVITE_ONLY") {
      partnership = await prisma.partnership.findFirst({
        where: {
          influencerId: influencer.id,
          productId,
          status: { in: ["APPROVED", "ACTIVE"] },
        },
      });
      if (!partnership) {
        return res.status(403).json({ error: "Brand approval required before generating a code" });
      }
      if (partnership.contentDeadline && new Date() > new Date(partnership.contentDeadline)) {
        await prisma.partnership.update({
          where: { id: partnership.id },
          data: { status: "EXPIRED" },
        });
        return res.status(403).json({ error: "Content deadline has passed. Contact the brand to extend." });
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

    const now = new Date();
    const coupon = await prisma.couponCode.create({
      data: {
        influencerId: influencer.id,
        productId,
        partnershipId: partnership?.id || null,
        code,
        activatedAt: now,
      },
      include: { product: { include: { brand: true } } },
    });

    if (partnership) {
      await prisma.partnership.update({
        where: { id: partnership.id },
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

    const payouts = await prisma.payout.findMany({
      where: { influencerId: influencer.id },
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

    res.json({ summary: { total, pending, released }, orders, payouts });
  } catch (err) {
    next(err);
  }
});

router.get("/instagram/eligibility", requireVerified, async (req, res, next) => {
  try {
    const influencer = req.user.influencerProfile;
    const eligibility = checkEligibility({
      followerCount: influencer.followerCount,
      engagementRate: influencer.engagementRate ? Number(influencer.engagementRate) : null,
    });
    res.json({ eligibility, profile: influencer });
  } catch (err) {
    next(err);
  }
});

router.post("/instagram/sync", requireVerified, async (req, res, next) => {
  try {
    const schema = z.object({
      instagramHandle: z.string().min(1),
      followerCount: z.number().int().min(0).optional(),
      engagementRate: z.number().min(0).max(100).optional(),
    });
    const data = schema.parse(req.body);

    await fetchInstagramProfile(data.instagramHandle);
    const result = await syncInstagramForUser(
      req.user.id,
      data.instagramHandle,
      data.followerCount,
      data.engagementRate
    );
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch("/payout-details", requireVerified, async (req, res, next) => {
  try {
    const schema = z.object({
      payoutUpi: z.string().optional(),
      payoutAccountName: z.string().optional(),
      payoutBankAccount: z.string().optional(),
      payoutIfsc: z.string().optional(),
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

router.patch("/profile", requireVerified, async (req, res, next) => {
  try {
    const schema = z.object({
      displayName: z.string().min(2).optional(),
      bio: z.string().optional(),
      instagramHandle: z.string().optional(),
      followerCount: z.number().int().min(0).optional(),
      engagementRate: z.number().min(0).max(100).optional(),
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
