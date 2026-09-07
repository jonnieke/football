import { getPrisma } from "@fcp/database";

const slugIndex = process.argv.indexOf("--slug");
const slug = slugIndex === -1 ? undefined : process.argv[slugIndex + 1];
if (slug === undefined)
  throw new Error("Usage: pnpm api-key:revoke --slug <slug>");
const prisma = getPrisma();
await prisma.apiClient.update({
  where: { slug },
  data: { status: "revoked", revokedAt: new Date() },
});
await prisma.$disconnect();
console.log(`Revoked API client ${slug}.`);
