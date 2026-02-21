import { google } from "googleapis";
import OpenAI from "openai";
import fs from "fs";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const spreadsheetId = "PASTE_YOUR_SHEET_ID_HERE";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function scoreJobs() {
  const sheets = await getSheetsClient();

  const intakeResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Job Intake!A2:I",
  });

  const rows = intakeResponse.data.values || [];
  if (rows.length === 0) {
    console.log("No jobs found.");
    return;
  }

  const masterResume = JSON.parse(
    fs.readFileSync("data/master_resume.json", "utf-8")
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const [
      jobId,
      company,
      role,
      location,
      applyUrl,
      jobDescription,
      source,
      dateAdded,
      status
    ] = row;

    if (status !== "NEW") continue;

    console.log(`Scoring job: ${company} - ${role}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
You are an expert SaaS hiring evaluator.

Score resume match from 0–100 based on:
- Role alignment
- Seniority fit
- Demand generation relevance
- SaaS experience
- Leadership depth

Respond ONLY in JSON:

{
  "score": number,
  "strengths": "short paragraph",
  "gaps": "short paragraph"
}
`
        },
        {
          role: "user",
          content: `
JOB DESCRIPTION:
${jobDescription}

RESUME:
${JSON.stringify(masterResume)}
`
        }
      ]
    });

    const content = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(content);

    const score = parsed.score;
    const decision = score >= 80 ? "APPLY" : "SKIP";

    // Write to Scoring sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Scoring!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          jobId,
          company,
          role,
          score,
          decision,
          parsed.strengths,
          parsed.gaps,
          decision === "APPLY"
            ? "Strong alignment with demand generation leadership."
            : "Insufficient alignment with seniority or SaaS depth.",
          new Date().toISOString()
        ]]
      }
    });

    // Update Job Intake status to SCORED
    const rowNumber = i + 2; // because sheet starts at A2
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Job Intake!I${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["SCORED"]]
      }
    });

    console.log(`Completed scoring for ${jobId} → ${decision}`);
  }
}

scoreJobs().catch(err => {
  console.error("Scoring error:", err);
  process.exit(1);
});
