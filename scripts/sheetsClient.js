import { google } from "googleapis";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

export async function appendJobIntakeRow(jobData) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const jobId = `JOB-${Date.now()}`;

  const row = [
    jobId,
    jobData.company,
    jobData.role,
    jobData.location,
    jobData.applyUrl,
    jobData.jobDescription,
    jobData.source,
    new Date().toISOString(),
    "NEW"
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Job Intake!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });

  console.log(`✅ Job added with ID: ${jobId}`);

  return jobId;
}
