import { google } from "googleapis";
import fs from "fs";
import { execSync } from "child_process";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function run() {
  const sheets = await getSheetsClient();

  const scoringData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Scoring!A2:J",
  });

  const scoringRows = scoringData.data.values || [];

  const intakeData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Job Intake!A2:I",
  });

  const intakeRows = intakeData.data.values || [];

  for (let i = 0; i < scoringRows.length; i++) {
    const row = scoringRows[i];

    const [
      jobId,
      company,
      role,
      score,
      decision,
      strengths,
      gaps,
      reason,
      dateScored,
      resumeGenerated
    ] = row;

    if (decision !== "APPLY") continue;
    if (resumeGenerated === "TRUE") continue;

    console.log(`Generating resume for ${jobId}`);

    // Find job description from intake
    const intakeMatch = intakeRows.find(r => r[0] === jobId);
    if (!intakeMatch) continue;

    const jobDescription = intakeMatch[5];

    // Write JD into file for resume engine
    fs.writeFileSync("data/job_description.txt", jobDescription);

    // Run resume generation pipeline
    execSync("node scripts/generateResume.js", { stdio: "inherit" });

    const newFileName = `resume_${jobId}.pdf`;

    // Rename generated file
    fs.renameSync(
      "output/resume_output.pdf",
      `output/${newFileName}`
    );

    // Log into Resume Log sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Resume Log!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          jobId,
          company,
          role,
          newFileName,
          new Date().toISOString(),
          "",   // headline optional
          "v1"
        ]]
      }
    });

    // Mark Resume_Generated = TRUE
    const rowNumber = i + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Scoring!J${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["TRUE"]]
      }
    });

    console.log(`Resume generated and logged for ${jobId}`);
  }
}

run().catch(err => {
  console.error("Resume generation error:", err);
  process.exit(1);
});
