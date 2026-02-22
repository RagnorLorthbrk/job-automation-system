import { google } from "googleapis";
import OpenAI from "openai";
import fs from "fs";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

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

    if (!status || status.toUpperCase() !== "NEW") continue;

    console.log(`Scoring job: ${company} - ${role}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
You are a senior global digital marketing hiring strategist.

Candidate profile:
- 10+ years digital marketing (B2B + B2C)
- Agency + in-house
- Enterprise brands + SMEs
- Performance marketing specialist
- Paid media, CRM automation, lifecycle
- run email marketing campaigns 
- set up and manage CRM automations
- Run anf set uip affiliate marketing campaigns
- Run Social Media Ads
- Run Instagram, tik-tok, meta, snapchat, reddit, Pinterest, twitter (X) ads
- Google ads, bing ads, Google Ads Editor, Bing Ads Editors 
- Demand generation, acquisition, growth
- Multi-industry exposure
- Budgets managed from $10 to $1M+

IMPORTANT RULES:
- Industry mismatch alone should NOT reduce score.
- Functional mismatch MUST reduce score heavily.
- Any non-digital role (legal, HR, field engineering, sales ops, etc.) should score below 10.
- Social media, paid media, growth, demand gen, CRM, lifecycle, performance roles are relevant.
- Broader digital marketing leadership is a strength.

Return ONLY valid JSON:

{
  "score": number (0-100),
  "decision": "APPLY" or "SKIP",
  "strengths": "concise paragraph",
  "gaps": "concise paragraph",
  "reason": "short explanation"
}
`
        },
        {
          role: "user",
          content: `
JOB TITLE:
${role}

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

    // Adjustable threshold
    const threshold = 60;

    const decision = score >= threshold ? "APPLY" : "SKIP";

    // Write to Scoring sheet aligned with YOUR headers:
    // Job_ID | Company | Role | Match_Score | Decision | Strengths | Gaps | Reason | Date_Scored | Resume_Generated

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
          parsed.reason,
          new Date().toISOString(),
          "FALSE"
        ]]
      }
    });

    // Update Intake status to SCORED
    const rowNumber = i + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Job Intake!I${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["SCORED"]]
      }
    });

    console.log(`Completed scoring for ${jobId} → ${decision} (${score})`);
  }
}

scoreJobs().catch(err => {
  console.error("Scoring error:", err);
  process.exit(1);
});
