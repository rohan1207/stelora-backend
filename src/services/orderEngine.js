import crypto from "crypto";
import prisma from "../utils/prisma.js";
import { checkFraud } from "./fraudGuard.js";
import { calcCommission, calcPlatformFee } from "./commissionCalc.js";

const CONTENT_DEADLINE_DAYS = 7;

export function getContentDeadline(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + CONTENT_DEADLINE_DAYS);
  return d;
}

export function buildCreatorSnapshot(influencer) {
  return {
    displayName: influencer.displayName,
    username: influencer.username,
    instagramHandle: influencer.instagramHandle,
    followerCount: influencer.followerCount,
    engagementRate: influencer.engagementRate ? Number(influencer.engagementRate) : null,
    niche: influencer.niche,
    bio: influencer.bio,
    capturedAt: new Date().toISOString(),
  };
}

export async function recordOrder({
  couponCode,
  customerEmail,
  orderAmount,
  externalOrderId,
  source = "MANUAL",
  skipBrandCheck = false,
  brandUserId = null,
}) {
  if (!skipBrandCheck && brandUserId && couponCode.product.brand.userId !== brandUserId) {
    throw Object.assign(new Error("This coupon is not for your brand's product"), { status: 403 });
  }

  if (externalOrderId) {
    const dup = await prisma.order.findUnique({
      where: {
        externalOrderId_productId: {
          externalOrderId,
          productId: couponCode.productId,
        },
      },
    });
    if (dup) return { order: dup, duplicate: true };
  }

  const fraud = await checkFraud({
    customerEmail,
    influencerUserId: couponCode.influencer.userId,
    productId: couponCode.productId,
  });
  if (fraud.blocked) {
    throw Object.assign(new Error(fraud.reason), { status: 400 });
  }

  const commissionAmount = calcCommission(orderAmount, couponCode.product.commissionPercent);
  const platformFee = calcPlatformFee(commissionAmount);

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        couponCodeId: couponCode.id,
        productId: couponCode.productId,
        customerEmail,
        orderAmount,
        commissionAmount,
        platformFee,
        status: "CONFIRMED",
        payoutStatus: "HELD",
        externalOrderId: externalOrderId || null,
        source,
      },
      include: {
        couponCode: { include: { influencer: true } },
        product: true,
      },
    });

    await tx.couponCode.update({
      where: { id: couponCode.id },
      data: {
        usageCount: { increment: 1 },
        totalRevenue: { increment: orderAmount },
      },
    });

    return created;
  });

  return { order, duplicate: false };
}

export async function loadCouponByCode(code) {
  return prisma.couponCode.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      product: { include: { brand: true } },
      influencer: { include: { user: true } },
    },
  });
}

export function generateWebhookApiKey() {
  return `stelora_${crypto.randomBytes(24).toString("hex")}`;
}
