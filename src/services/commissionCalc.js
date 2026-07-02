import { env } from "../config/env.js";

export function calcCommission(orderAmount, commissionPercent) {
  const amount = Number(orderAmount);
  const rate = Number(commissionPercent);
  return Math.round((amount * rate) / 100 * 100) / 100;
}

export function calcPlatformFee(commissionAmount) {
  const commission = Number(commissionAmount);
  return Math.round((commission * env.platformFeePercent) / 100 * 100) / 100;
}

export function calcInfluencerEarnings(commissionAmount, platformFee) {
  return Math.round((Number(commissionAmount) - Number(platformFee)) * 100) / 100;
}
