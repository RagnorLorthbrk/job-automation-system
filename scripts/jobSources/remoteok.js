import { insertJob } from "../sheetInsert.js";
import { evaluateJobFit } from "../aiFitClassifier.js";

function shouldEvaluate(title = "") {
  const t = title.toLowerCase();

  // BLOCKED FUNCTIONS (never send to AI)
  const blocked = [
    "engineer",
    "developer",
    "devops",
    "data",
    "hr",
    "talent",
    "recruit",
    "legal",
    "finance",
    "accountant",
    "paralegal",
    "architect",
    "it ",
    "field",
    "security",
    "nurse",
    "robotics",
    "assistant",
    "consultant",
    "scientist",
    "technician",
    "project manager",
    "product manager",
    "operations",
    "support",
    "customer success",
    "sales",
    "business development"
  ];

  if (blocked.some(k => t.includes(k))) {
    return false;
  }

  // ALLOWED MARKETING SIGNALS
  const allowed = [
    "marketing",
    "growth",
    "google ads",
    "bing ads",
    "DV360",
    "Facebook ads"
    "Instagram ads",
    "Automation",
    "reddit ads",
    "ad ops",
    "affiliate marketing",
    "email marketing",
    "google ads editor",
    "Paid search",
    "paid social",
    "AI Digital Campaign",
    "demand",
    "paid",
    "performance",
    "acquisition",
    "crm",
    "lifecycle",
    "media",
    "digital",
    "strategy"
  ];

  return allowed.some(k => t.includes(k));
}

export async function fetchRemoteOK() {
  console.log("Fetching RemoteOK jobs...");

  const response = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const data = await response.json();
  const jobs = data.slice(1);

  for (const job of jobs) {
    const normalized = {
      external_id: "REMOTEOK-" + job.id,
      company: job.company || "",
      role: job.position || "",
      location: job.location || "",
      apply_url: job.url || "",
      description: job.description || "",
      source: "RemoteOK"
    };

    if (!normalized.role) continue;

    // HARD FILTER BEFORE AI
    if (!shouldEvaluate(normalized.role)) {
      console.log("Hard skipped:", normalized.role);
      continue;
    }

    console.log("Evaluating:", normalized.role);

    const result = await evaluateJobFit(normalized);

    console.log("AI Result:", result);

    if (result.fit && result.confidence >= 70) {
      await insertJob(normalized);
    }
  }
}
