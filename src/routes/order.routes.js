import { Router } from "express";
import { z } from "zod";
import prisma from "../utils/prisma.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { loadCouponByCode, recordOrder } from "../services/orderEngine.js";

const router = Router();

router.post("/validate", async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().min(4) }).parse(req.body);
    const coupon = await loadCouponByCode(code);
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
      externalOrderId: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const coupon = await loadCouponByCode(data.code);
    if (!coupon || !coupon.isActive) {
      return res.status(404).json({ error: "Invalid or inactive coupon code" });
    }

    const result = await recordOrder({
      couponCode: coupon,
      customerEmail: data.customerEmail,
      orderAmount: data.orderAmount,
      externalOrderId: data.externalOrderId,
      source: "MANUAL",
      brandUserId: req.user.id,
    });

    if (result.duplicate) {
      return res.status(409).json({ error: "Order already recorded", order: result.order });
    }

    res.status(201).json({ order: result.order });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
