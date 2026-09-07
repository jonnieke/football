import { createApiKeyMaterial, getPrisma } from "@fcp/database";
import { v7 as uuidv7 } from "uuid";

const args = new Map(
  process.argv
    .slice(2)
    .flatMap((value, index, all) =>
      value.startsWith("--") ? [[value.slice(2), all[index + 1] ?? ""]] : [],
    ),
);
const name = args.get("name");
const slug = args.get("slug");
const rateLimit = Number(args.get("rate-limit") ?? 120);
if (
  name === undefined ||
  slug === undefined ||
  !Number.isInteger(rateLimit) ||
  rateLimit < 1
) {
  throw new Error(
    "Usage: pnpm api-key:create --name <name> --slug <slug> [--rate-limit 120]",
  );
}
const prisma = getPrisma();
const material = await createApiKeyMaterial();
const client = await prisma.apiClient.create({
  data: {
    id: uuidv7(),
    name,
    slug,
    keyPrefix: material.prefix,
    keyHash: material.hash,
    rateLimit,
  },
});
await prisma.$disconnect();
console.log(`Created API client ${client.slug} (${client.id}).`);
console.log("Store this key securely; it will not be shown again:");
console.log(material.plaintext);
