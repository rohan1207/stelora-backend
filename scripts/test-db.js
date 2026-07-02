import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

console.log("Testing database connection...");
console.log("Host from DATABASE_URL:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

try {
  await prisma.$connect();
  const count = await prisma.user.count();
  console.log("SUCCESS — connected! Users in DB:", count);
} catch (err) {
  console.error("FAILED —", err.message);
  console.log("\nFix checklist:");
  console.log("1. Supabase dashboard → open project → click Restore if paused");
  console.log("2. Settings → Database → copy fresh Connection string (URI)");
  console.log("3. Encode @ in password as %40");
  console.log("4. Try Session pooler string (port 5432) or Transaction pooler (port 6543)");
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
