import { appendJobIntakeRow } from "./sheetsClient.js";

async function run() {
  await appendJobIntakeRow({
    company: "Sirion",
    role: "Director of Demand Generation",
    location: "Remote",
    applyUrl: "https://example.com/apply",
    jobDescription: "Enterprise SaaS demand generation leadership role.",
    source: "Manual"
  });
}

run();
