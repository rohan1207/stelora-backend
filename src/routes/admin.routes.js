import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(authMiddleware, requireRole("ADMIN"));

router.get("/dashboard", async (_req, res, next) => {
  try {
    const [users, orders, products, pendingUsers] = await Promise.all([
      prisma.user.count(),
      prisma.order.count({ where: { status: "CONFIRMED" } }),
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { status: "PENDING" } }),
    ]);

    const revenue = await prisma.order.aggregate({
      where: { status: "CONFIRMED" },
      _sum: { orderAmount: true, platformFee: true },
    });

    res.json({
      stats: {
        totalUsers: users,
        pendingVerifications: pendingUsers,
        totalOrders: orders,
        activeProducts: products,
        totalGMV: Number(revenue._sum.orderAmount || 0),
        platformRevenue: Number(revenue._sum.platformFee || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const { status, role } = req.query;
    const users = await prisma.user.findMany({
      where: {
        ...(status && { status }),
        ...(role && { role }),
      },
      include: { brandProfile: true, influencerProfile: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id/verify", async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: "VERIFIED" },
      include: { brandProfile: true, influencerProfile: true },
    });
    if (user.influencerProfile) {
      await prisma.influencerProfile.update({
        where: { id: user.influencerProfile.id },
        data: { verificationStatus: "VERIFIED" },
      });
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id/suspend", async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: "SUSPENDED" },
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.get("/orders", async (_req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        couponCode: { include: { influencer: true } },
        product: { include: { brand: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

router.post("/seed-demo", async (_req, res, next) => {
  try {
    const existing = await prisma.user.findFirst({ where: { email: "admin@pass.app" } });
    if (existing) return res.json({ message: "Demo data already seeded" });

    const adminHash = await bcrypt.hash("admin12345", 12);
    await prisma.user.create({
      data: {
        email: "admin@pass.app",
        passwordHash: adminHash,
        role: "ADMIN",
        status: "VERIFIED",
      },
    });

    res.json({ message: "Demo admin created: admin@pass.app / admin12345" });
  } catch (err) {
    next(err);
  }
});

export default router;
