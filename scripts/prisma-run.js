import { execSync } from "child_process";

// Workaround: antivirus/SSL inspection blocks Prisma engine downloads
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2).join(" ");
execSync(`npx prisma ${args}`, { stdio: "inherit", env: process.env });
