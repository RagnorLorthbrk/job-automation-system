import axios from "axios";
import { roleMatches, passesVisaOrRemote } from "../filters.js";
import { insertJob } from "../sheetInsert.js";

export async function fetchRemoteOK() {
  const res = await axios.get("https://remoteok.com/api");

  const jobs = res.data.slice(1); // first item is metadata

  for (const job of jobs) {
    const normalized = {
      external_id: "REMOTEOK-" + job.id,
      company: job.company,
      role: job.position,
      location: job.location || "Remote",
      apply_url: job.url,
      description: job.description || "",
      source: "RemoteOK"
    };

    if (!roleMatches(normalized.role, normalized.description)) continue;
    if (!passesVisaOrRemote(normalized.location, normalized.description)) continue;

    await insertJob(normalized);
  }
}
