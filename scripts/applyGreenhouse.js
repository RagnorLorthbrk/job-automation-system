import { google } from "googleapis";
import { chromium } from "playwright";
import fs from "fs";
import { execSync } from "child_process";

const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";
const MAX_APPLICATIONS_PER_RUN = 2;

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing in environment.");
  process.exit(1);
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT is missing in environment.");
  process.exit(1);
}

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

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

/* ---------------- FILE WAIT ---------------- */

async function waitForFile(path, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(path)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/* ---------------- RESUME ---------------- */

async function generateResumeForJob(jobId, jobDescription) {
  try {
    if (!fs.existsSync("output")) {
      fs.mkdirSync("output");
    }

    fs.writeFileSync("data/job_description.txt", jobDescription);

    execSync("node scripts/generateResume.js", { stdio: "inherit" });

    const exists = await waitForFile("output/resume_output.pdf");
    if (!exists) throw new Error("resume_output.pdf not created");

    const newFile = `output/resume_${jobId}.pdf`;
    fs.renameSync("output/resume_output.pdf", newFile);

    return newFile;
  } catch (err) {
    console.error("❌ Resume generation failed:", err.message);
    return null;
  }
}

/* ---------------- SMART FILL ---------------- */

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

/* ---------------- SUCCESS DETECTION ---------------- */

async function verifySubmission(page, originalUrl) {

  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {});

  const currentUrl = page.url();

  // 1️⃣ URL changed
  if (currentUrl !== originalUrl) {
    return true;
  }

  // 2️⃣ Form disappeared
  const formExists = await page.locator("form").count();
  if (!formExists) {
    return true;
  }

  // 3️⃣ Validation errors visible
  const errorText = (await page.content()).toLowerCase();
  if (errorText.includes("required") ||
      errorText.includes("error") ||
      errorText.includes("invalid")) {
    return false;
  }

  // 4️⃣ Success text
  if (errorText.includes("thank") ||
      errorText.includes("submitted") ||
      errorText.includes("received")) {
    return true;
  }

  return false;
}

/* ---------------- APPLY ---------------- */

async function applyToGreenhouse(page, jobUrl, resumePath) {

  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
  const originalUrl = page.url();

  const buttons = page.locator("button, a");
  const btnCount = await buttons.count();

  for (let i = 0; i < btnCount; i++) {
    const text = (await buttons.nth(i).innerText()).toLowerCase();
    if (text.includes("apply")) {
      await buttons.nth(i).click();
      await page.waitForTimeout(2500);
      break;
    }
  }

  await smartFill(page, ["first"], FIRST_NAME);
  await smartFill(page, ["last"], LAST_NAME);
  await smartFill(page, ["email"], EMAIL);
  await smartFill(page, ["phone"], PHONE);
  await smartFill(page, ["linkedin"], LINKEDIN);

  const fileInput = page.locator('input[type="file"]');
  if (!(await fileInput.count())) {
    throw new Error("Resume upload field not found");
  }

  await fileInput.first().setInputFiles(resumePath);

  const submitBtn = page.locator('button[type="submit"], input[type="submit"]');
  if (!(await submitBtn.count())) {
    throw new Error("Submit button not found");
  }

  await submitBtn.first().click();

  const success = await verifySubmission(page, originalUrl);

  if (!success) {
    throw new Error("Submission not confirmed");
  }

  return true;
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

    const resumePath =
      await generateResumeForJob(jobId, jobDescription);

    if (!resumePath) continue;

    try {

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

      console.log("✅ Application confirmed.");

    } catch (err) {
      console.error("❌ Application failed:", err.message);
    }
  }

  await browser.close();
}

run().catch(console.error);
