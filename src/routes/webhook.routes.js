import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import prisma from "../utils/prisma.js";
import { loadCouponByCode, recordOrder } from "../services/orderEngine.js";

const router = Router();

async function authenticateBrandByApiKey(req) {
  const apiKey =
    req.headers["x-stelora-api-key"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!apiKey) return null;

  return prisma.brandProfile.findUnique({
    where: { webhookApiKey: apiKey },
    include: { user: true },
  });
}

router.post("/order", async (req, res, next) => {
  try {
    const brand = await authenticateBrandByApiKey(req);
    if (!brand) {
      return res.status(401).json({ error: "Invalid or missing API key" });
    }

    const schema = z.object({
      coupon_code: z.string().min(4),
      order_id: z.string().min(1),
      order_amount: z.number().positive(),
      customer_email: z.string().email(),
      currency: z.string().default("INR"),
    });
    const data = schema.parse(req.body);

    const coupon = await loadCouponByCode(data.coupon_code);
    if (!coupon || !coupon.isActive) {
      return res.status(404).json({ error: "Invalid or inactive coupon code" });
    }
    if (coupon.product.brandId !== brand.id) {
      return res.status(403).json({ error: "Coupon does not belong to this brand" });
    }

    const result = await recordOrder({
      couponCode: coupon,
      customerEmail: data.customer_email,
      orderAmount: data.order_amount,
      externalOrderId: data.order_id,
      source: "WEBHOOK",
      skipBrandCheck: true,
    });

    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      duplicate: result.duplicate,
      order: result.order,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post("/shopify/orders", async (req, res, next) => {
  try {
    const hmac = req.headers["x-shopify-hmac-sha256"];
    const shopDomain = req.headers["x-shopify-shop-domain"];

    let brand = null;
    if (shopDomain) {
      brand = await prisma.brandProfile.findFirst({
        where: { shopifyStoreUrl: { contains: shopDomain, mode: "insensitive" } },
      });
    }

    if (brand?.shopifyWebhookSecret && hmac) {
      const digest = crypto
        .createHmac("sha256", brand.shopifyWebhookSecret)
        .update(JSON.stringify(req.body))
        .digest("base64");
      if (digest !== hmac) {
        return res.status(401).json({ error: "Invalid Shopify signature" });
      }
    }

    const order = req.body;
    const discountCodes = (order.discount_codes || []).map((d) => d.code?.toUpperCase()).filter(Boolean);
    if (!discountCodes.length) {
      return res.json({ success: true, matched: false, reason: "No discount codes" });
    }

    const results = [];
    for (const code of discountCodes) {
      const coupon = await loadCouponByCode(code);
      if (!coupon || !coupon.isActive) continue;
      if (brand && coupon.product.brandId !== brand.id) continue;

      const customerEmail = order.email || order.contact_email || "unknown@shopify.order";
      const orderAmount = Number(order.total_price || order.subtotal_price || 0);
      if (!orderAmount) continue;

      const result = await recordOrder({
        couponCode: coupon,
        customerEmail,
        orderAmount,
        externalOrderId: `shopify_${order.id}`,
        source: "SHOPIFY",
        skipBrandCheck: true,
      });
      results.push({ code, orderId: result.order.id, duplicate: result.duplicate });
    }

    res.json({ success: true, matched: results.length > 0, results });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post("/razorpay/payment", async (req, res, next) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const event = req.body?.event;
    const payload = req.body?.payload?.payment?.entity;

    if (!payload) {
      return res.status(400).json({ error: "Invalid Razorpay payload" });
    }

    const couponCode = payload.notes?.coupon_code || payload.notes?.couponCode;
    if (!couponCode) {
      return res.json({ success: true, matched: false, reason: "No coupon in payment notes" });
    }

    const brands = await prisma.brandProfile.findMany({
      where: { razorpayWebhookSecret: { not: null } },
    });

    if (signature && brands.length) {
      const brand = brands.find((b) => {
        if (!b.razorpayWebhookSecret) return false;
        const expected = crypto
          .createHmac("sha256", b.razorpayWebhookSecret)
          .update(JSON.stringify(req.body))
          .digest("hex");
        return expected === signature;
      });
      if (!brand && process.env.NODE_ENV === "production") {
        return res.status(401).json({ error: "Invalid Razorpay signature" });
      }
    }

    if (event !== "payment.captured") {
      return res.json({ success: true, matched: false, reason: "Event ignored" });
    }

    const coupon = await loadCouponByCode(couponCode);
    if (!coupon || !coupon.isActive) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    const orderAmount = Number(payload.amount) / 100;
    const customerEmail = payload.email || payload.notes?.customer_email || "unknown@razorpay.order";

    const result = await recordOrder({
      couponCode: coupon,
      customerEmail,
      orderAmount,
      externalOrderId: `razorpay_${payload.id}`,
      source: "RAZORPAY",
      skipBrandCheck: true,
    });

    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      duplicate: result.duplicate,
      order: result.order,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
