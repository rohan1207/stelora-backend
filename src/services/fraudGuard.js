import prisma from "../utils/prisma.js";

export async function checkFraud({ customerEmail, influencerUserId, productId }) {
  const influencer = await prisma.influencerProfile.findUnique({
    where: { userId: influencerUserId },
  });
  if (!influencer) return { blocked: true, reason: "Influencer not found" };

  const influencerUser = await prisma.user.findUnique({
    where: { id: influencerUserId },
  });
  if (influencerUser && influencerUser.email.toLowerCase() === customerEmail.toLowerCase()) {
    return { blocked: true, reason: "Self-purchase is not allowed" };
  }

  const recentDuplicate = await prisma.order.findFirst({
    where: {
      customerEmail: { equals: customerEmail, mode: "insensitive" },
      productId,
      status: "CONFIRMED",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (recentDuplicate) {
    return { blocked: true, reason: "Duplicate order from same customer within 24 hours" };
  }

  return { blocked: false };
}
