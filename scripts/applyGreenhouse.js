import { google } from "googleapis";
import { chromium } from "playwright";
import fs from "fs";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

const MAX_APPLICATIONS_PER_RUN = 2;

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

async function fillField(page, selectors, value) {
  for (const selector of selectors) {
    const el = page.locator(selector);
    if (await el.count()) {
      await el.first().fill(value);
      return true;
    }
  }
  return false;
}

async function applyToGreenhouse(page, jobUrl, resumePath) {
  console.log("Opening:", jobUrl);

  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const applyButton = page.locator('text=Apply');
  if (await applyButton.count()) {
    await applyButton.first().click();
    await page.waitForTimeout(2000);
  }

  console.log("Filling basic fields...");

  await fillField(page, [
    'input[name="first_name"]',
    'input[id="first_name"]',
    'input[name="job_application[first_name]"]'
  ], FIRST_NAME);

  await fillField(page, [
    'input[name="last_name"]',
    'input[id="last_name"]',
    'input[name="job_application[last_name]"]'
  ], LAST_NAME);

  await fillField(page, [
    'input[name="email"]',
    'input[id="email"]',
    'input[name="job_application[email]"]'
  ], EMAIL);

  await fillField(page, [
    'input[name="phone"]',
    'input[id="phone"]',
    'input[name="job_application[phone]"]'
  ], PHONE);

  const resumeInput = page.locator('input[type="file"]');
  if (await resumeInput.count()) {
    console.log("Uploading resume...");
    await resumeInput.first().setInputFiles(resumePath);
  }

  await fillField(page, [
    'input[name*="linkedin"]',
    'input[id*="linkedin"]'
  ], LINKEDIN);

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

  const checkboxes = page.locator('input[type="checkbox"]');
  const cbCount = await checkboxes.count();
  for (let i = 0; i < cbCount; i++) {
    const cb = checkboxes.nth(i);
    if (!(await cb.isChecked())) {
      await cb.check();
    }
  }

  await page.waitForTimeout(1500);

  const submitBtn = page.locator('button[type="submit"]');
  if (await submitBtn.count()) {
    console.log("Submitting application...");
    await submitBtn.first().click();
  }

  await page.waitForTimeout(4000);
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

  const applicationsData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Applications!A2:J",
  });

  const applicationRows = applicationsData.data.values || [];

  const browser = await chromium.launch({ headless: true });
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
      resumeGenerated
    ] = scoringRows[i];

    if (decision !== "APPLY") continue;
    if (resumeGenerated !== "TRUE") continue;

    const intakeMatch = intakeRows.find(r => r[0] === jobId);
    if (!intakeMatch) continue;

    const applyUrl = intakeMatch[4];
    if (!applyUrl || !applyUrl.includes("greenhouse.io")) continue;

    const appIndex = applicationRows.findIndex(r => r[0] === jobId);

    let applicationStatus = "PENDING";

    if (appIndex !== -1) {
      applicationStatus = applicationRows[appIndex][6];
    }

    if (applicationStatus !== "PENDING") continue;

    // 🔥 FIXED PATH HERE
    const resumePath = `resume_${jobId}.pdf`;

    console.log(`Applying to ${company} - ${role}`);

    try {
      await applyToGreenhouse(page, applyUrl, resumePath);

      const today = new Date().toISOString();

      if (appIndex === -1) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Applications!A1",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[
              jobId,
              company,
              role,
              `resume_${jobId}.pdf`,
              "",
              today,
              "SUBMITTED",
              "",
              ""
            ]]
          }
        });
      }

      appliedCount++;

    } catch (err) {
      console.error("Application failed:", err);
    }
  }

  await browser.close();
}

run().catch(console.error);
