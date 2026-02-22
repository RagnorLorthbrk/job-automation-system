import { roleMatches, passesVisaOrRemote } from "../filters.js";
import { insertJob } from "../sheetInsert.js";

export async function fetchRemoteOK() {
  console.log("Fetching RemoteOK jobs...");

  const response = await fetch("https://remoteok.com/api", {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`RemoteOK API error: ${response.status}`);
  }

  const data = await response.json();

  // First item is metadata
  const jobs = data.slice(1);

  let insertedCount = 0;

  for (const job of jobs) {
    const normalized = {
      external_id: "REMOTEOK-" + job.id,
      company: job.company || "",
      role: job.position || "",
      location: job.location || "Remote",
      apply_url: job.url || "",
      description: job.description || "",
      source: "RemoteOK"
    };

    if (!roleMatches(normalized.role, normalized.description)) {
      continue;
    }

    if (!passesVisaOrRemote(normalized.location, normalized.description)) {
      continue;
    }

    await insertJob(normalized);
    insertedCount++;
  }

  console.log(`RemoteOK inserted: ${insertedCount}`);
}
