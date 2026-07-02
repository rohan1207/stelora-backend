import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function webhookKey() {
  return `stelora_${crypto.randomBytes(24).toString("hex")}`;
}

async function main() {
  const adminEmail = "admin@pass.app";
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await bcrypt.hash("admin12345", 12),
        role: "ADMIN",
        status: "VERIFIED",
      },
    });
    console.log("Created admin: admin@pass.app / admin12345");
  }

  const brandEmail = "brand@demo.com";
  let brandUser = await prisma.user.findUnique({
    where: { email: brandEmail },
    include: { brandProfile: true },
  });
  if (!brandUser) {
    brandUser = await prisma.user.create({
      data: {
        email: brandEmail,
        passwordHash: await bcrypt.hash("demo12345", 12),
        role: "BRAND",
        status: "VERIFIED",
        brandProfile: {
          create: {
            companyName: "GlowSkin Co.",
            niche: "Beauty & Skincare",
            description: "Premium skincare for Indian skin",
            website: "https://glowskin.example.com",
            webhookApiKey: webhookKey(),
          },
        },
      },
      include: { brandProfile: true },
    });
    console.log("Created brand: brand@demo.com / demo12345");
  } else if (brandUser.brandProfile && !brandUser.brandProfile.webhookApiKey) {
    await prisma.brandProfile.update({
      where: { id: brandUser.brandProfile.id },
      data: { webhookApiKey: webhookKey() },
    });
  }

  const influencerEmail = "creator@demo.com";
  let influencerUser = await prisma.user.findUnique({
    where: { email: influencerEmail },
    include: { influencerProfile: true },
  });
  if (!influencerUser) {
    influencerUser = await prisma.user.create({
      data: {
        email: influencerEmail,
        passwordHash: await bcrypt.hash("demo12345", 12),
        role: "INFLUENCER",
        status: "VERIFIED",
        influencerProfile: {
          create: {
            displayName: "Priya Sharma",
            username: "priya",
            niche: "Beauty & Skincare",
            bio: "Skincare tips & honest reviews",
            instagramHandle: "priyaskincare",
            followerCount: 45000,
            engagementRate: 3.5,
            verificationStatus: "VERIFIED",
            instagramVerified: true,
          },
        },
      },
      include: { influencerProfile: true },
    });
    console.log("Created influencer: creator@demo.com / demo12345");
  }

  const brand = brandUser.brandProfile;
  if (brand) {
    const productCount = await prisma.product.count({ where: { brandId: brand.id } });
    if (productCount === 0) {
      await prisma.product.createMany({
        data: [
          {
            brandId: brand.id,
            name: "Vitamin C Serum",
            description: "Brightening serum with 20% Vitamin C",
            price: 899,
            commissionPercent: 20,
            campaignMode: "APPROVAL",
            status: "ACTIVE",
          },
          {
            brandId: brand.id,
            name: "Hydrating Moisturizer",
            description: "Lightweight daily moisturizer for all skin types",
            price: 649,
            commissionPercent: 15,
            campaignMode: "APPROVAL",
            status: "ACTIVE",
          },
          {
            brandId: brand.id,
            name: "SPF 50 Sunscreen",
            description: "Matte finish sunscreen, no white cast",
            price: 549,
            commissionPercent: 18,
            campaignMode: "APPROVAL",
            status: "ACTIVE",
          },
        ],
      });
      console.log("Created demo products (APPROVAL mode)");
    } else {
      await prisma.product.updateMany({
        where: { brandId: brand.id, campaignMode: "OPEN" },
        data: { campaignMode: "APPROVAL" },
      });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
