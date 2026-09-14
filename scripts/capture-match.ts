import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { captureCompletedMatch } from "./replay-capture.js";

// This importer never creates database/Redis clients or loads application config.
// The existing private worker file is read only for its provider key. Nothing
// from it is installed into process.env or written into the captured artifact.
if (process.argv[2] !== "--capture")
  throw new Error("Explicit --capture required (up to 3 API requests)");
try {
  const values = parse(
    await readFile(new URL("../.env.workers.local", import.meta.url)),
  );
  const { capture, requests } = await captureCompletedMatch(
    values.API_FOOTBALL_KEY ?? "",
  );
  const directory = new URL("../.sandbox-replay/captures/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const name = `${capture.fixtureId}-${randomUUID()}.json`;
  await writeFile(new URL(name, directory), JSON.stringify(capture, null, 2), {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      capture: name,
      requests,
      fixtureId: capture.fixtureId,
      productionWrites: 0,
    }),
  );
} catch {
  // Do not echo provider bodies, environment values or network error causes.
  console.error(
    "Match capture failed. No replay started; provider/connection or response validation requires checking.",
  );
  process.exitCode = 1;
}
