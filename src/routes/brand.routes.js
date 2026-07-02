import { Router } from "express";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole, requireVerified } from "../middleware/auth.js";

const router = Router();

router.use(authMiddleware, requireRole("BRAND"), requireVerified);

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  price: z.number().positive(),
  commissionPercent: z.number().min(1).max(50),
  campaignMode: z.enum(["OPEN", "APPROVAL", "INVITE_ONLY"]).default("OPEN"),
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
    });
    if (!application) return res.status(404).json({ error: "Application not found" });

    const updated = await prisma.partnership.update({
      where: { id: application.id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approvedAt: action === "approve" ? new Date() : null,
      },
      include: { influencer: true, product: true },
    });
    res.json({ application: updated });
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
