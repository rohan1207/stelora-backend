import { Router } from "express";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { checkFraud } from "../services/fraudGuard.js";
import { calcCommission, calcPlatformFee } from "../services/commissionCalc.js";

const router = Router();

router.post("/validate", async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().min(4) }).parse(req.body);
    const coupon = await prisma.couponCode.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        product: { include: { brand: true } },
        influencer: true,
      },
    });
    if (!coupon || !coupon.isActive) {
      return res.status(404).json({ valid: false, error: "Invalid or inactive coupon code" });
    }
    if (coupon.product.status !== "ACTIVE") {
      return res.status(400).json({ valid: false, error: "Product is not active" });
    }
    res.json({
      valid: true,
      code: coupon.code,
      product: coupon.product,
      influencer: coupon.influencer,
      commissionPercent: coupon.product.commissionPercent,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/redeem", authMiddleware, requireRole("BRAND"), async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(4),
      customerEmail: z.string().email(),
      orderAmount: z.number().positive(),
    });
    const data = schema.parse(req.body);

    const coupon = await prisma.couponCode.findUnique({
      where: { code: data.code.toUpperCase() },
      include: {
        product: { include: { brand: true } },
        influencer: { include: { user: true } },
      },
    });
    if (!coupon || !coupon.isActive) {
      return res.status(404).json({ error: "Invalid or inactive coupon code" });
    }
    if (coupon.product.brand.userId !== req.user.id) {
      return res.status(403).json({ error: "This coupon is not for your brand's product" });
    }

    const fraud = await checkFraud({
      customerEmail: data.customerEmail,
      influencerUserId: coupon.influencer.userId,
      productId: coupon.productId,
    });
    if (fraud.blocked) {
      return res.status(400).json({ error: fraud.reason });
    }

    const commissionAmount = calcCommission(data.orderAmount, coupon.product.commissionPercent);
    const platformFee = calcPlatformFee(commissionAmount);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          couponCodeId: coupon.id,
          productId: coupon.productId,
          customerEmail: data.customerEmail,
          orderAmount: data.orderAmount,
          commissionAmount,
          platformFee,
          status: "CONFIRMED",
          payoutStatus: "HELD",
        },
        include: {
          couponCode: { include: { influencer: true } },
          product: true,
        },
      });

      await tx.couponCode.update({
        where: { id: coupon.id },
        data: {
          usageCount: { increment: 1 },
          totalRevenue: { increment: data.orderAmount },
        },
      });

      return created;
    });

    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

export default router;
