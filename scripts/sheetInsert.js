import { google } from "googleapis";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function insertJob(job) {
  const sheets = await getSheetsClient();

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Job Intake!A2:A",
  });

  const existingIds = (existing.data.values || []).map(r => r[0]);

  if (existingIds.includes(job.external_id)) {
    console.log("Duplicate skipped:", job.external_id);
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Job Intake!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        job.external_id,
        job.company,
        job.role,
        job.location,
        job.apply_url,
        job.description,
        job.source,
        new Date().toISOString(),
        "NEW"
      ]]
    }
  });

  console.log("Inserted:", job.role);
}
