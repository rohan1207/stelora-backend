import pg from "pg";
import "dotenv/config";

const password = encodeURIComponent("Stelora@072003");
const ref = "edvpvgsxbxwtuapwemlj";
const regions = [
  "ap-south-1",
  "ap-southeast-1",
  "us-east-1",
  "us-west-1",
  "eu-west-1",
  "eu-central-1",
  "ap-northeast-1",
];

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

for (const region of regions) {
  const url = `postgresql://postgres.${ref}:${password}@aws-0-${region}.pooler.supabase.com:5432/postgres?sslmode=require`;
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const r = await client.query("SELECT 1 as ok");
    console.log(`SUCCESS — region: ${region}`, r.rows[0]);
    await client.end();
    console.log(`\nUse this DATABASE_URL:\n${url.replace(password, "YOUR_PASSWORD_ENCODED")}`);
    process.exit(0);
  } catch (err) {
    console.log(`FAIL — ${region}: ${err.message.split("\n")[0]}`);
    await client.end().catch(() => {});
  }
}

console.log("\nNo region worked. Check Supabase dashboard: project may be paused or ref is wrong.");
