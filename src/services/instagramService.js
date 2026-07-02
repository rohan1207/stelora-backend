import prisma from "../utils/prisma.js";

const MIN_FOLLOWERS = 1000;
const MIN_ENGAGEMENT = 1.0;

/**
 * MVP Instagram eligibility — uses stored profile data.
 * Phase 4 can plug Phyllo/Meta Graph API into fetchInstagramProfile().
 */
export async function fetchInstagramProfile(handle) {
  const clean = handle.replace(/^@/, "").trim().toLowerCase();
  if (!clean) {
    throw Object.assign(new Error("Instagram handle is required"), { status: 400 });
  }

  // Placeholder: in production, call Phyllo or Meta Graph API here.
  // For now return structured data if creator already has counts on file.
  const existing = await prisma.influencerProfile.findFirst({
    where: { instagramHandle: { equals: clean, mode: "insensitive" } },
  });

  return {
    handle: clean,
    followerCount: existing?.followerCount ?? null,
    engagementRate: existing?.engagementRate ? Number(existing.engagementRate) : null,
    fetchedAt: new Date().toISOString(),
    source: "manual_pending_api",
    profileUrl: `https://instagram.com/${clean}`,
  };
}

export function checkEligibility({ followerCount, engagementRate }) {
  const issues = [];
  if (followerCount < MIN_FOLLOWERS) {
    issues.push(`Minimum ${MIN_FOLLOWERS.toLocaleString()} followers required`);
  }
  if (engagementRate != null && engagementRate < MIN_ENGAGEMENT) {
    issues.push(`Minimum ${MIN_ENGAGEMENT}% engagement rate required`);
  }
  return {
    eligible: issues.length === 0,
    issues,
    criteria: { minFollowers: MIN_FOLLOWERS, minEngagement: MIN_ENGAGEMENT },
  };
}

export async function syncInstagramForUser(userId, handle, followerCount, engagementRate) {
  const profile = await prisma.influencerProfile.update({
    where: { userId },
    data: {
      instagramHandle: handle.replace(/^@/, ""),
      followerCount: followerCount ?? undefined,
      engagementRate: engagementRate ?? undefined,
      instagramFetchedAt: new Date(),
    },
  });

  const eligibility = checkEligibility({
    followerCount: profile.followerCount,
    engagementRate: profile.engagementRate ? Number(profile.engagementRate) : null,
  });

  return { profile, eligibility };
}
