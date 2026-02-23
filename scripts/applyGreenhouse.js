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

/* ============== SMART FIELD FILLING ENGINE ============== */

async function fillTextFields(page) {
  const inputs = await page.$$(
    "input[type='text'], input[type='email'], input[type='tel'], textarea"
  );

  for (const input of inputs) {
    const name = ((await input.getAttribute("name")) || "").toLowerCase();
    const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
    const label = (await input.evaluate(el => el.parentElement?.textContent || "")).toLowerCase();

    // Check if already filled
    const currentValue = await input.inputValue().catch(() => "");
    if (currentValue && currentValue.trim()) continue;

    // Smart matching logic
    if (name.includes("first") || placeholder.includes("first") || label.includes("first")) {
      await input.fill(FIRST_NAME).catch(() => {});
    } else if (name.includes("last") || placeholder.includes("last") || label.includes("last")) {
      await input.fill(LAST_NAME).catch(() => {});
    } else if (name.includes("email") || placeholder.includes("email") || label.includes("email")) {
      await input.fill(EMAIL).catch(() => {});
    } else if (name.includes("phone") || placeholder.includes("phone") || label.includes("phone")) {
      await input.fill(PHONE).catch(() => {});
    } else if (name.includes("linkedin") || placeholder.includes("linkedin") || label.includes("linkedin")) {
      await input.fill(LINKEDIN).catch(() => {});
    }
  }
}

async function fillSelects(page) {
  const selects = await page.$$("select");

  for (const select of selects) {
    try {
      const options = await select.$$("option");
      if (options.length > 1) {
        // Skip first option (usually "Select..."), pick second
        const value = await options[1].getAttribute("value");
        if (value) {
          await select.selectOption(value).catch(() => {});
        }
      }
    } catch (e) {
      // Skip problematic selects
    }
  }
}

async function checkCheckboxes(page) {
  const checkboxes = await page.$$("input[type='checkbox']");
  for (const box of checkboxes) {
    try {
      const isChecked = await box.isChecked().catch(() => false);
      if (!isChecked) {
        await box.check().catch(() => {});
      }
    } catch (e) {
      // Skip problematic checkboxes
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
    try {
      const first = grouped[group][0];
      const isChecked = await first.isChecked().catch(() => false);
      if (!isChecked) {
        await first.check().catch(() => {});
      }
    } catch (e) {
      // Skip problematic radios
    }
  }
}

/* ============== IMPROVED SUBMISSION DETECTION ============== */

async function confirmSubmission(page, maxWaitTime = 15000) {
  console.log("🔍 Checking submission confirmation...");
  
  const startTime = Date.now();
  let lastUrl = page.url();

  // Strategy 1: URL change detection (most reliable)
  try {
    await page.waitForNavigation({ timeout: 5000, waitUntil: "networkidle" }).catch(() => {});
  } catch (e) {
    // Navigation may not happen, that's ok
  }

  const newUrl = page.url();
  console.log(`📍 URL changed: ${lastUrl} → ${newUrl}`);

  // Check if URL indicates success
  const successUrlPatterns = [
    /thank/i,
    /success/i,
    /submitted/i,
    /complete/i,
    /confirmation/i,
    /received/i,
  ];

  if (successUrlPatterns.some(pattern => pattern.test(newUrl))) {
    console.log("✅ Success detected via URL pattern");
    return true;
  }

  // Strategy 2: Page content analysis
  const html = await page.content();
  const text = await page.innerText().catch(() => "");

  const successPhrases = [
    "thank you for applying",
    "application received",
    "your application has been submitted",
    "thanks for applying",
    "we have received your application",
    "application submitted",
    "submitted successfully",
    "next steps",
    "what happens next",
    "we'll be in touch",
    "application confirmed",
  ];

  for (const phrase of successPhrases) {
    if (text.toLowerCase().includes(phrase)) {
      console.log(`✅ Success phrase detected: "${phrase}"`);
      return true;
    }
  }

  // Strategy 3: Check for form persistence (form gone = likely submitted)
  const formStillExists = await page.$("form[action*='submit']").catch(() => null);
  if (!formStillExists) {
    // Give page time to load confirmation
    await page.waitForTimeout(2000);
    
    // Re-check for success indicators
    const updatedText = await page.innerText().catch(() => "");
    
    if (!updatedText.toLowerCase().includes("error") && 
        !updatedText.toLowerCase().includes("required")) {
      console.log("✅ Form disappeared and no errors detected");
      return true;
    }
  }

  // Strategy 4: Check for specific Greenhouse confirmation elements
  const greenHouseConfirmed = await page.$(
    "[data-test='submission-success'], .submission-success, .confirmation-message"
  ).catch(() => null);

  if (greenHouseConfirmed) {
    console.log("✅ Greenhouse confirmation element found");
    return true;
  }

  // Strategy 5: Wait and retry (give async operations time to complete)
  await page.waitForTimeout(3000);
  const finalText = await page.innerText().catch(() => "");

  if (successPhrases.some(phrase => finalText.toLowerCase().includes(phrase))) {
    console.log("✅ Success phrase detected after delay");
    return true;
  }

  return false;
}

/* ============== APPLICATION SUBMISSION ============== */

async function applyToGreenhouse(page, jobUrl, resumePath) {
  console.log(`🔗 Navigating to: ${jobUrl}`);
  
  await page.goto(jobUrl, { waitUntil: "load", timeout: 30000 });

  // Give page time to fully load
  await page.waitForTimeout(2000);

  console.log("📝 Filling form fields...");
  await fillTextFields(page);
  await fillSelects(page);
  await checkCheckboxes(page);
  await clickRadioIfRequired(page);

  // Find and upload resume
  console.log("📄 Uploading resume...");
  const fileInput = await page.$("input[type='file']");
  if (!fileInput) {
    throw new Error("Resume upload field not found on page");
  }

  await fileInput.setInputFiles(resumePath);
  await page.waitForTimeout(1000); // Let file upload settle

  // Find submit button with multiple strategies
  let submit = await page.$("button[type='submit']");
  if (!submit) submit = await page.$("input[type='submit']");
  if (!submit) submit = await page.$("button:has-text('Submit')");
  if (!submit) submit = await page.$("button:has-text('Apply')");
  if (!submit) submit = await page.$("button:has-text('Send')");

  if (!submit) {
    throw new Error("Submit button not found on page");
  }

  console.log("🚀 Clicking submit button...");
  await submit.click();

  // Wait for submission to complete
  const success = await confirmSubmission(page);

  if (!success) {
    console.log("⚠️ Submission confirmation unclear. Saving debug files...");

    const timestamp = Date.now();
    try {
      await page.screenshot({
        path: `failure_${timestamp}.png`,
        fullPage: true,
      });
      console.log(`📸 Screenshot saved: failure_${timestamp}.png`);
    } catch (e) {
      console.log("Could not save screenshot");
    }

    try {
      const html = await page.content();
      fs.writeFileSync(`failure_${timestamp}.html`, html);
      console.log(`📄 HTML saved: failure_${timestamp}.html`);
    } catch (e) {
      console.log("Could not save HTML");
    }

    throw new Error("Submission confirmation not detected");
  }

  console.log("✅ Application submitted successfully!");
}

/* ============== MAIN EXECUTION ============== */

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

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Applying → ${company} | ${role}`);
    console.log(`${'='.repeat(60)}`);

    const resumePath = await generateResumeForJob(jobId, jobDescription);

    if (!resumePath) {
      console.log("⚠️ Resume generation failed, skipping...");
      continue;
    }

    try {
      await applyToGreenhouse(page, applyUrl, resumePath);

      const today = new Date().toISOString().split('T')[0];

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

      console.log(`✅ Application logged to sheet`);
      appliedCount++;

    } catch (err) {
      console.error(`❌ Application failed: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n🎯 Applied to ${appliedCount} jobs this run`);
}

run().catch(console.error);
