import { Router } from "express";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole, requireVerified } from "../middleware/auth.js";
import { getContentDeadline, generateWebhookApiKey } from "../services/orderEngine.js";
import { initiateCreatorPayout } from "../services/payoutService.js";

const router = Router();

router.use(authMiddleware, requireRole("BRAND"), requireVerified);

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  price: z.number().positive(),
  commissionPercent: z.number().min(1).max(50),
  campaignMode: z.enum(["OPEN", "APPROVAL", "INVITE_ONLY"]).default("APPROVAL"),
});

router.get("/dashboard", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    if (!brand) return res.status(404).json({ error: "Brand profile not found" });

    const products = await prisma.product.findMany({
      where: { brandId: brand.id },
      include: {
        couponCodes: { include: { influencer: true } },
        orders: { where: { status: "CONFIRMED" } },
        partnerships: { where: { status: "PENDING" } },
      },
    });

    const totalRevenue = products.reduce(
      (sum, p) => sum + p.orders.reduce((s, o) => s + Number(o.orderAmount), 0),
      0
    );
    const totalCommission = products.reduce(
      (sum, p) => sum + p.orders.reduce((s, o) => s + Number(o.commissionAmount), 0),
      0
    );
    const pendingApplications = products.reduce((sum, p) => sum + p.partnerships.length, 0);
    const activeCodes = products.reduce((sum, p) => sum + p.couponCodes.filter((c) => c.isActive).length, 0);

    res.json({
      stats: {
        totalProducts: products.length,
        totalRevenue,
        totalCommission,
        pendingApplications,
        activeCodes,
        totalOrders: products.reduce((sum, p) => sum + p.orders.length, 0),
      },
      recentOrders: await prisma.order.findMany({
        where: { product: { brandId: brand.id }, status: "CONFIRMED" },
        include: {
          couponCode: { include: { influencer: true } },
          product: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/products", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const products = await prisma.product.findMany({
      where: { brandId: brand.id },
      include: {
        _count: { select: { couponCodes: true, orders: true, partnerships: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

router.get("/products/:id/creators", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, brandId: brand.id },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const partnerships = await prisma.partnership.findMany({
      where: { productId: product.id, status: { not: "REJECTED" } },
      include: {
        influencer: true,
        couponCode: {
          include: {
            orders: { where: { status: "CONFIRMED" } },
          },
        },
      },
      orderBy: { appliedAt: "desc" },
    });

    const creators = partnerships.map((p) => {
      const orders = p.couponCode?.orders || [];
      const revenue = orders.reduce((s, o) => s + Number(o.orderAmount), 0);
      const commission = orders.reduce((s, o) => s + Number(o.commissionAmount), 0);
      const daysLeft = p.contentDeadline
        ? Math.max(0, Math.ceil((new Date(p.contentDeadline) - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;

      return {
        partnership: {
          id: p.id,
          status: p.status,
          applicationMessage: p.applicationMessage,
          creatorSnapshot: p.creatorSnapshot,
          appliedAt: p.appliedAt,
          approvedAt: p.approvedAt,
          contentDeadline: p.contentDeadline,
          contentSubmittedAt: p.contentSubmittedAt,
          daysLeft,
        },
        influencer: p.influencer,
        coupon: p.couponCode
          ? {
              code: p.couponCode.code,
              isActive: p.couponCode.isActive,
              usageCount: p.couponCode.usageCount,
              activatedAt: p.couponCode.activatedAt,
            }
          : null,
        stats: {
          orders: orders.length,
          revenue,
          commission,
        },
      };
    });

    res.json({ product, creators });
  } catch (err) {
    next(err);
  }
});

router.post("/products", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const data = productSchema.parse(req.body);

    const product = await prisma.product.create({
      data: {
        brandId: brand.id,
        name: data.name,
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        price: data.price,
        commissionPercent: data.commissionPercent,
        campaignMode: data.campaignMode,
        status: "ACTIVE",
      },
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

router.patch("/products/:id", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const data = productSchema.partial().parse(req.body);

    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, brandId: brand.id },
    });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...data,
        imageUrl: data.imageUrl === "" ? null : data.imageUrl,
      },
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

router.get("/applications", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const applications = await prisma.partnership.findMany({
      where: {
        product: { brandId: brand.id },
        status: "PENDING",
      },
      include: {
        influencer: true,
        product: true,
      },
      orderBy: { appliedAt: "desc" },
    });
    res.json({ applications });
  } catch (err) {
    next(err);
  }
});

router.patch("/applications/:id", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const { action } = z.object({ action: z.enum(["approve", "reject"]) }).parse(req.body);

    const application = await prisma.partnership.findFirst({
      where: {
        id: req.params.id,
        product: { brandId: brand.id },
        status: "PENDING",
      },
      include: { influencer: { include: { user: true } }, product: true },
    });
    if (!application) return res.status(404).json({ error: "Application not found" });

    const now = new Date();
    const updated = await prisma.partnership.update({
      where: { id: application.id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approvedAt: action === "approve" ? now : null,
        contentDeadline: action === "approve" ? getContentDeadline(now) : null,
      },
      include: { influencer: true, product: true },
    });

    if (action === "approve" && application.influencer.user) {
      await prisma.notification.create({
        data: {
          userId: application.influencer.user.id,
          type: "PARTNERSHIP_APPROVED",
          title: "Application approved!",
          body: `${brand.companyName} approved your application for ${application.product.name}. You have 7 days to post content and generate your coupon code.`,
        },
      });
    }

    res.json({ application: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/payouts/:influencerId", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);

    const hasPartnership = await prisma.partnership.findFirst({
      where: {
        influencerId: req.params.influencerId,
        product: { brandId: brand.id },
        status: { in: ["APPROVED", "ACTIVE"] },
      },
    });
    if (!hasPartnership) {
      return res.status(403).json({ error: "No active partnership with this creator" });
    }

    const payout = await initiateCreatorPayout(req.params.influencerId, amount, {
      brandId: brand.id,
    });
    res.status(201).json({ payout });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get("/integrations", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    res.json({
      webhookApiKey: brand.webhookApiKey,
      shopifyStoreUrl: brand.shopifyStoreUrl,
      razorpayKeyId: brand.razorpayKeyId,
      hasRazorpaySecret: !!brand.razorpayKeySecret,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/integrations/webhook-key", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const key = generateWebhookApiKey();
    const updated = await prisma.brandProfile.update({
      where: { id: brand.id },
      data: { webhookApiKey: key },
    });
    res.json({ webhookApiKey: updated.webhookApiKey });
  } catch (err) {
    next(err);
  }
});

router.patch("/integrations", async (req, res, next) => {
  try {
    const schema = z.object({
      shopifyStoreUrl: z.string().optional(),
      shopifyWebhookSecret: z.string().optional(),
      razorpayKeyId: z.string().optional(),
      razorpayKeySecret: z.string().optional(),
      razorpayWebhookSecret: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const brand = req.user.brandProfile;

    const profile = await prisma.brandProfile.update({
      where: { id: brand.id },
      data,
    });
    res.json({
      shopifyStoreUrl: profile.shopifyStoreUrl,
      razorpayKeyId: profile.razorpayKeyId,
      hasRazorpaySecret: !!profile.razorpayKeySecret,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/analytics", async (req, res, next) => {
  try {
    const brand = req.user.brandProfile;
    const orders = await prisma.order.findMany({
      where: { product: { brandId: brand.id }, status: "CONFIRMED" },
      include: {
        couponCode: { include: { influencer: true } },
        product: true,
      },
    });

    const byInfluencer = {};
    for (const order of orders) {
      const inf = order.couponCode.influencer;
      const key = inf.id;
      if (!byInfluencer[key]) {
        byInfluencer[key] = {
          influencer: inf,
          orders: 0,
          revenue: 0,
          commission: 0,
        };
      }
      byInfluencer[key].orders += 1;
      byInfluencer[key].revenue += Number(order.orderAmount);
      byInfluencer[key].commission += Number(order.commissionAmount);
    }

    const byProduct = {};
    for (const order of orders) {
      const key = order.product.id;
      if (!byProduct[key]) {
        byProduct[key] = { product: order.product, orders: 0, revenue: 0 };
      }
      byProduct[key].orders += 1;
      byProduct[key].revenue += Number(order.orderAmount);
    }

    res.json({
      summary: {
        totalOrders: orders.length,
        totalRevenue: orders.reduce((s, o) => s + Number(o.orderAmount), 0),
        totalCommission: orders.reduce((s, o) => s + Number(o.commissionAmount), 0),
        avgOrderValue: orders.length
          ? orders.reduce((s, o) => s + Number(o.orderAmount), 0) / orders.length
          : 0,
      },
      byInfluencer: Object.values(byInfluencer).sort((a, b) => b.revenue - a.revenue),
      byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/profile", async (req, res, next) => {
  try {
    const schema = z.object({
      companyName: z.string().min(2).optional(),
      website: z.string().optional(),
      niche: z.string().optional(),
      description: z.string().optional(),
      logoUrl: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const profile = await prisma.brandProfile.update({
      where: { userId: req.user.id },
      data,
    });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

export default router;
