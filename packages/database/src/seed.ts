import { getPrisma } from "./client.js";
import { v7 as uuidv7 } from "uuid";

const prisma = getPrisma();

const templates = [
  [
    "goal",
    "short",
    "GOAL! {{minute}}' {{homeTeam}} {{homeScore}}-{{awayScore}} {{awayTeam}}.",
  ],
  [
    "half_time",
    "short",
    "HT: {{homeTeam}} {{homeScore}}-{{awayScore}} {{awayTeam}}.",
  ],
  [
    "match_finished",
    "short",
    "FT: {{homeTeam}} {{homeScore}}-{{awayScore}} {{awayTeam}}.",
  ],
] as const;

for (const [eventType, templateType, templateText] of templates) {
  await prisma.contentTemplate.upsert({
    where: {
      eventType_templateType_language_version: {
        eventType,
        templateType,
        language: "en",
        version: 1,
      },
    },
    create: {
      id: uuidv7(),
      eventType,
      templateType,
      language: "en",
      version: 1,
      templateText,
    },
    update: { templateText, enabled: true },
  });
}

await prisma.$disconnect();
console.log("Seeded deterministic content templates.");
