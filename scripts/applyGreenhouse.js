import { google } from "googleapis";
import { chromium } from "playwright";
import fs from "fs";
import { execSync } from "child_process";

const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";
const MAX_APPLICATIONS_PER_RUN = 2;

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY missing");
  process.exit(1);
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
  console.error("❌ GOOGLE_SERVICE_ACCOUNT missing");
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

/* ---------------- Sheets ---------------- */

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/* ---------------- Resume ---------------- */

async function waitForFile(path, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(path)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function generateResumeForJob(jobId, jobDescription) {
  try {
    if (!fs.existsSync("output")) fs.mkdirSync("output");

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

/* ---------------- Smart Field Engine ---------------- */

async function fillTextFields(page) {
  const inputs = await page.$$(
    "input[type='text'], input[type='email'], input[type='tel'], textarea"
  );

  for (const input of inputs) {
    const name = ((await input.getAttribute("name")) || "").toLowerCase();

    if (name.includes("first")) await input.fill(FIRST_NAME).catch(() => {});
    else if (name.includes("last")) await input.fill(LAST_NAME).catch(() => {});
    else if (name.includes("email")) await input.fill(EMAIL).catch(() => {});
    else if (name.includes("phone")) await input.fill(PHONE).catch(() => {});
    else if (name.includes("linkedin")) await input.fill(LINKEDIN).catch(() => {});
  }
}

async function fillSelects(page) {
  const selects = await page.$$("select");

  for (const select of selects) {
    const options = await select.$$("option");
    if (options.length > 1) {
      const value = await options[1].getAttribute("value");
      if (value) {
        await select.selectOption(value).catch(() => {});
      }
    }
  }
}

async function checkCheckboxes(page) {
  const checkboxes = await page.$$("input[type='checkbox']");
  for (const box of checkboxes) {
    const isChecked = await box.isChecked().catch(() => false);
    if (!isChecked) {
      await box.check().catch(() => {});
    }
  }
}

async function clickRadioIfRequired(page) {
  const radios = await page.$$("input[type='radio']");
  const grouped = {};

  for (const radio of radios) {
    const name = await radio.getAttribute("name");
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(radio);
  }

  for (const group in grouped) {
    const first = grouped[group][0];
    await first.check().catch(() => {});
  }
}

/* ---------------- Submission Detection ---------------- */

async function confirmSubmission(page) {
  await page.waitForTimeout(5000);

  const url = page.url().toLowerCase();
  const html = (await page.content()).toLowerCase();

  if (
    url.includes("thank") ||
    url.includes("submitted") ||
    url.includes("complete")
  ) return true;

  const successPhrases = [
    "thank you for applying",
    "application received",
    "your application has been submitted",
    "thanks for applying",
    "we have received your application"
  ];

  for (const phrase of successPhrases) {
    if (html.includes(phrase)) return true;
  }

  const formExists = await page.$("form");
  if (!formExists) return true;

  return false;
}

/* ---------------- Apply ---------------- */

async function applyToGreenhouse(page, jobUrl, resumePath) {

  await page.goto(jobUrl, { waitUntil: "networkidle" });

  await fillTextFields(page);
  await fillSelects(page);
  await checkCheckboxes(page);
  await clickRadioIfRequired(page);

  const fileInput = await page.$("input[type='file']");
  if (!fileInput) throw new Error("Resume upload field missing");

  await fileInput.setInputFiles(resumePath);

  const submit =
    await page.$("button[type='submit']") ||
    await page.$("input[type='submit']");

  if (!submit) throw new Error("Submit button missing");

  await submit.click();

  const success = await confirmSubmission(page);

  if (!success) {
    console.log("❌ Submission not confirmed. Saving debug files.");

    const timestamp = Date.now();

    await page.screenshot({
      path: `failure_${timestamp}.png`,
      fullPage: true
    });

    const html = await page.content();
    fs.writeFileSync(`failure_${timestamp}.html`, html);

    throw new Error("Submission not confirmed");
  }

  console.log("✅ Submission confirmed.");
}

/* ---------------- Main ---------------- */

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

    } catch (err) {
      console.error("❌ Application failed:", err.message);
    }
  }

  await browser.close();
}

run().catch(console.error);
