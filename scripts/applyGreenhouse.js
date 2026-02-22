import { google } from "googleapis";
import { chromium } from "playwright";
import fs from "fs";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

const MAX_APPLICATIONS_PER_RUN = 2;

// Basic applicant info (comes from master resume file)
const master = JSON.parse(
  fs.readFileSync("data/master_resume.json", "utf-8")
);

const FIRST_NAME = master.personal.name.split(" ")[0];
const LAST_NAME = master.personal.name.split(" ").slice(1).join(" ");
const EMAIL = master.personal.email;
const PHONE = master.personal.phone;
const LINKEDIN = master.personal.linkedin;

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function applyToGreenhouse(page, jobUrl, resumePath) {
  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });

  // Click Apply button if present
  const applyButton = page.locator("text=Apply for this job");
  if (await applyButton.count()) {
    await applyButton.first().click();
  }

  await page.waitForTimeout(2000);

  // Fill basic fields (Greenhouse standard names)
  await page.fill('input[name="first_name"]', FIRST_NAME);
  await page.fill('input[name="last_name"]', LAST_NAME);
  await page.fill('input[name="email"]', EMAIL);

  if (await page.locator('input[name="phone"]').count()) {
    await page.fill('input[name="phone"]', PHONE);
  }

  // Resume upload
  const resumeInput = page.locator('input[type="file"]');
  if (await resumeInput.count()) {
    await resumeInput.setInputFiles(resumePath);
  }

  // LinkedIn if present
  const linkedinInput = page.locator('input[name*="linkedin"]');
  if (await linkedinInput.count()) {
    await linkedinInput.fill(LINKEDIN);
  }

  // Auto-fill dropdowns with first available option
  const selects = page.locator("select");
  const selectCount = await selects.count();

  for (let i = 0; i < selectCount; i++) {
    const select = selects.nth(i);
    const options = await select.locator("option").all();
    if (options.length > 1) {
      const value = await options[1].getAttribute("value");
      if (value) await select.selectOption(value);
    }
  }

  // Check all required checkboxes (e.g., GDPR)
  const checkboxes = page.locator('input[type="checkbox"]');
  const cbCount = await checkboxes.count();
  for (let i = 0; i < cbCount; i++) {
    const cb = checkboxes.nth(i);
    if (!(await cb.isChecked())) {
      await cb.check();
    }
  }

  await page.waitForTimeout(1500);

  // Submit
  const submitBtn = page.locator('button[type="submit"]');
  if (await submitBtn.count()) {
    await submitBtn.first().click();
  }

  await page.waitForTimeout(3000);
}

async function run() {
  const sheets = await getSheetsClient();

  const scoringData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Scoring!A2:K",
  });

  const scoringRows = scoringData.data.values || [];

  const intakeData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Job Intake!A2:I",
  });

  const intakeRows = intakeData.data.values || [];

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let appliedCount = 0;

  for (let i = 0; i < scoringRows.length; i++) {
    if (appliedCount >= MAX_APPLICATIONS_PER_RUN) break;

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
      resumeGenerated,
      applicationStatus
    ] = scoringRows[i];

    if (decision !== "APPLY") continue;
    if (resumeGenerated !== "TRUE") continue;
    if (applicationStatus !== "PENDING") continue;

    const intakeMatch = intakeRows.find(r => r[0] === jobId);
    if (!intakeMatch) continue;

    const applyUrl = intakeMatch[4];
    if (!applyUrl || !applyUrl.includes("greenhouse.io")) continue;

    const resumePath = `output/resume_${jobId}.pdf`;

    console.log(`Applying to ${company} - ${role}`);

    try {
      await applyToGreenhouse(page, applyUrl, resumePath);

      const rowNumber = i + 2;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Scoring!K${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["SUBMITTED"]],
        },
      });

      appliedCount++;

    } catch (err) {
      console.error("Application failed:", err);

      const rowNumber = i + 2;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Scoring!K${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["FAILED"]],
        },
      });
    }
  }

  await browser.close();
}

run().catch(console.error);
