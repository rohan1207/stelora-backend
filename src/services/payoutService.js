import prisma from "../utils/prisma.js";
import { env } from "../config/env.js";

/**
 * RazorpayX payout stub — wire real API when RAZORPAY_KEY_ID/SECRET are set.
 * Docs: https://razorpay.com/docs/x/payouts/
 */
export async function initiateCreatorPayout(influencerId, amount, notes = {}) {
  const influencer = await prisma.influencerProfile.findUnique({
    where: { id: influencerId },
  });
  if (!influencer) throw Object.assign(new Error("Influencer not found"), { status: 404 });
  if (!influencer.payoutUpi && !influencer.payoutBankAccount) {
    throw Object.assign(new Error("Creator has not added payout details"), { status: 400 });
  }

  const hasRazorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;

  const payout = await prisma.payout.create({
    data: {
      influencerId,
      amount,
      status: hasRazorpay ? "PROCESSING" : "PENDING",
      razorpayPayoutId: hasRazorpay ? `rzp_sim_${Date.now()}` : null,
      periodStart: new Date(),
      periodEnd: new Date(),
    },
  });

  if (hasRazorpay) {
    // TODO: POST https://api.razorpay.com/v1/payouts with fund_account_id
    console.log("[RazorpayX] Payout queued (simulated):", payout.id, amount, notes);
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: "PAID", paidAt: new Date() },
    });
  }

  return payout;
}

export async function releaseHeldOrdersForInfluencer(influencerId) {
  const holdDays = env.payoutHoldDays;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - holdDays);

  const result = await prisma.order.updateMany({
    where: {
      couponCode: { influencerId },
      payoutStatus: "HELD",
      status: "CONFIRMED",
      createdAt: { lte: cutoff },
    },
    data: { payoutStatus: "RELEASED" },
  });

  return result.count;
}
