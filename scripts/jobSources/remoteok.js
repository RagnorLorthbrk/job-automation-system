import { insertJob } from "../sheetInsert.js";
import { evaluateJobFit } from "../aiFitClassifier.js";

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

    console.log("Evaluating:", normalized.role);

    const result = await evaluateJobFit(normalized);

    console.log("AI Result:", result);

    if (result.fit && result.confidence >= 75) {
      await insertJob(normalized);
    }
  }
}
