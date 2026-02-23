import { google } from "googleapis";
import { chromium } from "playwright";
import fs from "fs";
import { execSync } from "child_process";

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

/* ---------------- SHEETS ---------------- */

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/* ---------------- HELPERS ---------------- */

async function waitForFile(path, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (fs.existsSync(path)) return true;
    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error(`File not created: ${path}`);
}

async function smartFill(page, keywords, value) {
  const inputs = page.locator("input, textarea");

  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    const name = (await el.getAttribute("name")) || "";
    const id = (await el.getAttribute("id")) || "";

    const match = keywords.some(k =>
      name.toLowerCase().includes(k) ||
      id.toLowerCase().includes(k)
    );

    if (match) {
      await el.fill(value);
      return true;
    }
  }
  return false;
}

/* ---------------- RESUME ---------------- */

async function generateResumeForJob(jobId, jobDescription) {

  if (!fs.existsSync("output")) {
    fs.mkdirSync("output");
  }

  fs.writeFileSync("data/job_description.txt", jobDescription);

  execSync("node scripts/generateResume.js", { stdio: "inherit" });

  await waitForFile("output/resume_output.pdf");

  const newFile = `output/resume_${jobId}.pdf`;

  fs.renameSync("output/resume_output.pdf", newFile);

  return newFile;
}

/* ---------------- GREENHOUSE APPLY ---------------- */

async function openApplicationForm(page) {

  const buttons = page.locator("button, a");

  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const text = (await buttons.nth(i).innerText()).toLowerCase();

    if (text.includes("apply")) {
      await buttons.nth(i).click();
      await page.waitForTimeout(2500);
      return;
    }
  }
}

async function verifySubmission(page) {

  const successIndicators = [
    "thank",
    "submitted",
    "received",
    "application"
  ];

  const body = (await page.content()).toLowerCase();

  return successIndicators.some(w => body.includes(w));
}

async function applyToGreenhouse(page, jobUrl, resumePath) {

  console.log("Opening:", jobUrl);

  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });

  await openApplicationForm(page);

  await smartFill(page, ["first"], FIRST_NAME);
  await smartFill(page, ["last"], LAST_NAME);
  await smartFill(page, ["email"], EMAIL);
  await smartFill(page, ["phone"], PHONE);
  await smartFill(page, ["linkedin"], LINKEDIN);

  const fileInput = page.locator('input[type="file"]');

  if (await fileInput.count()) {
    await fileInput.first().setInputFiles(resumePath);
  } else {
    throw new Error("Resume upload field not found");
  }

  const submitBtn = page.locator('button[type="submit"], input[type="submit"]');

  if (!(await submitBtn.count())) {
    throw new Error("Submit button not found");
  }

  await submitBtn.first().click();

  await page.waitForTimeout(5000);

  const success = await verifySubmission(page);

  if (!success) {
    throw new Error("Submission not confirmed");
  }
}

/* ---------------- MAIN ---------------- */

async function run() {

  const sheets = await getSheetsClient();

  const scoringRows =
    (await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Scoring!A2:J",
    })).data.values || [];

  const intakeRows =
    (await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Job Intake!A2:I",
    })).data.values || [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let appliedCount = 0;

  for (const row of scoringRows) {

    if (appliedCount >= MAX_APPLICATIONS_PER_RUN) break;

    const [jobId, company, role, , decision] = row;

    if (decision !== "APPLY") continue;

    const intake = intakeRows.find(r => r[0] === jobId);
    if (!intake) continue;

    const applyUrl = intake[4];
    const jobDescription = intake[5];

    if (!applyUrl?.includes("greenhouse.io")) continue;

    console.log(`Applying → ${company} | ${role}`);

    try {

      const resumePath =
        await generateResumeForJob(jobId, jobDescription);

      await applyToGreenhouse(page, applyUrl, resumePath);

      const today = new Date().toISOString();

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
            "SUBMITTED"
          ]]
        }
      });

      appliedCount++;

    } catch (err) {
      console.error("❌ Application failed:", err.message);
    }
  }

  await browser.close();
}

run().catch(console.error);
