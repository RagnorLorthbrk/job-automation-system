import { google } from "googleapis";
import { chromium } from "playwright";
import OpenAI from "openai";
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const master = JSON.parse(
  fs.readFileSync("data/master_resume.json", "utf-8")
);

const FIRST_NAME = master.personal.name.split(" ")[0];
const LAST_NAME  = master.personal.name.split(" ").slice(1).join(" ");
const EMAIL      = master.personal.email;
const PHONE      = master.personal.phone;
const LINKEDIN   = master.personal.linkedin;

// ─── Fields AI must NEVER touch ──────────────────────────────────────────────
const BLOCKED_FIELD_SIGNALS = [
  "recaptcha", "g-recaptcha", "captcha",
  "honeypot", "bot", "trap",
  "token", "csrf",
  "trusting", "adroit",
  "sonstiges",   // German honeypot "other"
  "utm_", "__jv",
];

// ─── Standard personal fields — filled deterministically, AI skips these ─────
// These signals appear in name/id/label of personal fields (English + German)
const STANDARD_FIELD_SIGNALS = [
  "first name", "first_name", "firstname",
  "last name",  "last_name",  "lastname",
  "email", "e-mail",
  "phone", "telephone", "mobile",
  "linkedin",
  "resume", "cv", "attach", "upload", "cover letter",
  // German
  "vorname", "nachname", "telefon", "lebenslauf", "anschreiben",
];

const SCREENSHOT_DIR = "output/screenshots";
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

/* ─────────────────────────────────────────────
   SHEETS CLIENT
───────────────────────────────────────────── */

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/* ─────────────────────────────────────────────
   RESUME GENERATION
───────────────────────────────────────────── */

async function waitForFile(filePath, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(filePath)) return true;
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

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

function isBlocked(combined)  { return BLOCKED_FIELD_SIGNALS.some(s => combined.includes(s)); }
function isStandard(combined) { return STANDARD_FIELD_SIGNALS.some(s => combined.includes(s)); }

/**
 * Reads the visible label for any form element.
 * Checks label[for=id] first, then nearest container label.
 */
async function getLabelText(elHandle) {
  return elHandle.evaluate(node => {
    if (node.id) {
      const lbl = document.querySelector(`label[for="${node.id}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    const parent = node.closest(
      ".field, .form-group, .application-question, li, .s-grid-field, div"
    );
    if (parent) {
      const lbl = parent.querySelector("label");
      if (lbl) return lbl.innerText.trim();
    }
    return "";
  });
}

/**
 * KEY FIX: Returns true if a given element handle is actually a <select>.
 * Used inside the text-input loop to skip elements whose label happens
 * to live inside a select's container — preventing text fill on dropdowns.
 */
async function isSelectElement(elHandle) {
  return elHandle.evaluate(node => node.tagName.toLowerCase() === "select");
}

/* ─────────────────────────────────────────────
   STANDARD FIELD FILLING  (English + German)
───────────────────────────────────────────── */

async function fillTextFields(page) {
  const inputs = await page.$$(
    "input[type='text'], input[type='email'], input[type='tel'], textarea"
  );

  for (const input of inputs) {
    try {
      const name        = ((await input.getAttribute("name"))        || "").toLowerCase();
      const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
      const id          = ((await input.getAttribute("id"))          || "").toLowerCase();
      const labelText   = (await getLabelText(input)).toLowerCase();
      const combined    = `${name} ${placeholder} ${id} ${labelText}`;

      if (isBlocked(combined)) continue;

      const currentValue = await input.inputValue().catch(() => "");
      if (currentValue && currentValue.trim()) continue;

      if      (/first.?name|firstname|vorname/.test(combined))              await input.fill(FIRST_NAME).catch(() => {});
      else if (/last.?name|lastname|nachname/.test(combined))               await input.fill(LAST_NAME).catch(() => {});
      else if (/e-?mail/.test(combined))                                    await input.fill(EMAIL).catch(() => {});
      else if (/phone|telefon|mobile|handynummer/.test(combined))           await input.fill(PHONE).catch(() => {});
      else if (/linkedin/.test(combined))                                   await input.fill(LINKEDIN).catch(() => {});
    } catch (e) {}
  }
}

async function checkCheckboxes(page) {
  const checkboxes = await page.$$("input[type='checkbox']");
  for (const box of checkboxes) {
    try {
      const name     = ((await box.getAttribute("name")) || "").toLowerCase();
      const id       = ((await box.getAttribute("id"))   || "").toLowerCase();
      const combined = `${name} ${id}`;
      if (isBlocked(combined)) continue;
      const isChecked = await box.isChecked().catch(() => false);
      if (!isChecked) await box.check().catch(() => {});
    } catch (e) {}
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
      if (!isChecked) await first.check().catch(() => {});
    } catch (e) {}
  }
}

/* ─────────────────────────────────────────────
   AI QUESTION ANSWERING
   TEXT INPUTS and SELECTS are handled in
   completely separate passes — no overlap.
───────────────────────────────────────────── */

async function answerCustomQuestions(page) {
  const jobDescription = fs.existsSync("data/job_description.txt")
    ? fs.readFileSync("data/job_description.txt", "utf-8")
    : "";

  const qaLog = [];

  // ── PASS 1: Text inputs and textareas only ───────────────────────────────
  // We explicitly check tagName so a select's container label never
  // causes a text fill attempt on the wrong element type.
  const textInputs = await page.$$(
    "input[type='text'], input[type='url'], textarea"
  );

  for (const input of textInputs) {
    try {
      // Double-check: skip anything that is actually a select (safety net)
      if (await isSelectElement(input)) continue;

      const name        = ((await input.getAttribute("name"))        || "").toLowerCase();
      const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
      const id          = ((await input.getAttribute("id"))          || "").toLowerCase();
      const labelText   = await getLabelText(input);
      const combined    = `${name} ${placeholder} ${id} ${labelText.toLowerCase()}`;

      if (isBlocked(combined))  { console.log(`🚫 Blocked field skipped: "${labelText || name}"`); continue; }
      if (isStandard(combined)) continue; // already handled by fillTextFields

      const currentValue = await input.inputValue().catch(() => "");
      if (currentValue && currentValue.trim()) continue;

      const questionText = labelText || placeholder || name;
      if (!questionText || questionText.trim().length < 3) continue;

      // ── CRITICAL CHECK: confirm this input does NOT belong to a select ──
      // Some Greenhouse forms render a hidden text input alongside a <select>
      // with the same label. We skip those.
      const siblingSelect = await input.evaluate(node => {
        const parent = node.closest(
          ".field, .form-group, .application-question, li, .s-grid-field, div"
        );
        if (!parent) return false;
        return parent.querySelector("select") !== null;
      });
      if (siblingSelect) continue; // let the select pass handle this question

      console.log(`🤖 AI answering (text): "${questionText}"`);
      const answer = await generateAIAnswer(questionText, jobDescription);

      if (answer) {
        await input.fill(answer).catch(() => {});
        qaLog.push({ question: questionText, answer });
        console.log(`   ✅ "${answer.substring(0, 80)}${answer.length > 80 ? "..." : ""}"`);
      }
    } catch (e) {}
  }

  // ── PASS 2: Select dropdowns only ───────────────────────────────────────
  const selects = await page.$$("select");

  for (const select of selects) {
    try {
      const name      = ((await select.getAttribute("name")) || "").toLowerCase();
      const id        = ((await select.getAttribute("id"))   || "").toLowerCase();
      const labelText = await getLabelText(select);
      const combined  = `${name} ${id} ${labelText.toLowerCase()}`;

      if (isBlocked(combined))  { console.log(`🚫 Blocked select skipped: "${labelText || name}"`); continue; }

      // Get all meaningful options (filter out placeholder entries)
      const options = await select.evaluate(el => {
        return Array.from(el.options)
          .map(o => ({ value: o.value, text: o.text.trim() }))
          .filter(o =>
            o.value &&
            o.text &&
            !/^select|^choose|^auswählen|^wählen\s|^--/i.test(o.text)
          );
      });

      if (options.length === 0) continue;

      // Skip if already has a real value selected
      const currentVal = await select.evaluate(el => el.value);
      if (currentVal && currentVal.trim() && currentVal !== "0") continue;

      const questionText = labelText || name;
      if (!questionText || questionText.trim().length < 3) continue;

      console.log(`🤖 AI selecting (dropdown): "${questionText}"`);
      const bestOption = await pickBestSelectOption(questionText, options, jobDescription);

      if (bestOption) {
        await select.selectOption(bestOption).catch(() => {});
        // Trigger change event so React/Vue forms register the selection
        await select.evaluate(el => {
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input",  { bubbles: true }));
        });
        const selectedText = options.find(o => o.value === bestOption)?.text || bestOption;
        qaLog.push({ question: questionText, answer: selectedText });
        console.log(`   ✅ Selected: "${selectedText}"`);
      }
    } catch (e) {}
  }

  return qaLog;
}

/* ─────────────────────────────────────────────
   OPENAI HELPERS
───────────────────────────────────────────── */

async function generateAIAnswer(question, jobDescription) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
You are filling out a job application on behalf of this candidate.

CANDIDATE PROFILE:
${JSON.stringify(master)}

JOB DESCRIPTION:
${jobDescription}

RULES:
- Answer ONLY the question asked. No preamble, no labels, no "Answer:".
- Keep answers concise (1-4 sentences unless clearly a long-form essay question).
- For yes/no questions → "Yes" or "No" only.
- For salary/compensation → "Open to discussion based on the role and total package."
- For notice period → "30 days."
- For work authorization / visa → "I am based in India and open to fully remote roles globally."
- For location/city → "New Delhi, India."
- For country → "India."
- For "why do you want to work here" → 2-3 relevant sentences using the job description.
- For hobby/fun fact → 1-2 genuine sentences based on the candidate profile.
- For "how did you find us" → "Through an online job board."
- Never fabricate metrics not in the candidate profile.
- If the question is in German, answer in German.
- Sound professional and confident.
`
        },
        { role: "user", content: `Question: ${question}` }
      ]
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error(`❌ AI text answer failed for "${question}":`, err.message);
    return null;
  }
}

async function pickBestSelectOption(question, options, jobDescription) {
  try {
    const optionsList = options.map(o => `"${o.value}": "${o.text}"`).join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `
You are filling out a job application on behalf of this candidate.

CANDIDATE PROFILE:
${JSON.stringify(master)}

JOB DESCRIPTION:
${jobDescription}

You will receive a dropdown question and its available options.
Respond ONLY with the exact value string of the best matching option.
No explanation. No quotes. Just the raw value string.
`
        },
        {
          role: "user",
          content: `Question: ${question}\n\nAvailable options:\n${optionsList}\n\nRespond with ONLY the value of the best option.`
        }
      ]
    });

    const picked = response.choices[0].message.content.trim().replace(/^"|"$/g, "");
    const valid  = options.find(o => o.value === picked);
    return valid ? picked : options[0].value; // fallback to first real option
  } catch (err) {
    console.error(`❌ AI select failed for "${question}":`, err.message);
    return options[0]?.value || null;
  }
}

function formatQAForSheet(qaLog) {
  if (!qaLog || qaLog.length === 0) return "No custom questions detected";
  return qaLog.map(qa => `Q: ${qa.question} | A: ${qa.answer}`).join(" || ");
}

/* ─────────────────────────────────────────────
   DOM ERROR SCRAPER
───────────────────────────────────────────── */

async function scrapeFormErrors(page) {
  return page.evaluate(() => {
    const selectors = [
      '[class*="error"]:not([style*="display: none"])',
      '[class*="invalid"]:not([style*="display: none"])',
      '[aria-invalid="true"]',
      '.field_with_errors',
      '[data-error]',
      '.alert-danger',
      '[role="alert"]',
    ];
    const errors = [];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const text = el.innerText?.trim();
        if (text) errors.push({ selector: sel, text });
      });
    });
    document.querySelectorAll("input, select, textarea").forEach(field => {
      if (!field.validity.valid) {
        errors.push({
          selector: `${field.tagName}[name="${field.name}"]`,
          text: field.validationMessage || "Field invalid",
          fieldName: field.name,
        });
      }
    });
    return errors;
  });
}

/* ─────────────────────────────────────────────
   NETWORK-LAYER SUBMISSION VALIDATOR
───────────────────────────────────────────── */

const GREENHOUSE_SUBMISSION_PATTERNS = [
  /greenhouse\.io.*\/applications/i,
  /greenhouse\.io.*\/submit/i,
  /boards\.greenhouse\.io.*\/applications/i,
  /job-boards\.greenhouse\.io.*\/applications/i,
];

function waitForCondition(conditionFn, timeout) {
  return new Promise((resolve, reject) => {
    const interval = 200;
    let elapsed = 0;
    const timer = setInterval(() => {
      if (conditionFn()) { clearInterval(timer); resolve(); }
      else {
        elapsed += interval;
        if (elapsed >= timeout) { clearInterval(timer); reject(new Error("timeout")); }
      }
    }, interval);
  });
}

async function detectConfirmationPage(page) {
  return page.evaluate(() => {
    const selectors = [
      '[class*="confirmation"]', '[class*="success"]', '[class*="thank"]',
      '[id*="confirmation"]',   '[id*="success"]',
      '[data-test="submission-success"]', '.submission-success', '.confirmation-message',
    ];
    const phrases = [
      "application received", "thank you for applying", "successfully submitted",
      "your application has been", "we have received your application",
      "thanks for applying", "next steps", "what happens next", "we'll be in touch",
      "bewerbung erhalten", "vielen dank für ihre bewerbung", "erfolgreich eingereicht",
    ];
    const body = document.body.innerText.toLowerCase();
    return (
      phrases.some(p => body.includes(p)) ||
      selectors.some(s => document.querySelector(s) !== null)
    );
  });
}

async function validateSubmission(page, clickAction, timeout = 15000) {
  let submissionRequest  = null;
  let submissionResponse = null;

  const onRequest = req => {
    if (
      (req.method() === "POST" || req.method() === "PUT") &&
      GREENHOUSE_SUBMISSION_PATTERNS.some(re => re.test(req.url()))
    ) {
      submissionRequest = { url: req.url(), method: req.method(), timestamp: Date.now() };
      console.log(`🌐 [Network] Submission request → ${req.url()}`);
    }
  };

  const onResponse = res => {
    if (submissionRequest && res.url() === submissionRequest.url && !submissionResponse) {
      submissionResponse = { url: res.url(), status: res.status(), timestamp: Date.now() };
      console.log(`🌐 [Network] Submission response → HTTP ${res.status()}`);
    }
  };

  page.on("request",  onRequest);
  page.on("response", onResponse);

  const preErrors = await scrapeFormErrors(page);
  if (preErrors.length > 0) {
    const unique = [...new Set(preErrors.map(e => e.text))];
    console.warn(`⚠️ Pre-click unfilled fields (${unique.length}):`);
    unique.forEach(t => console.warn(`   • ${t}`));
  }

  const urlBefore = page.url();
  try { await clickAction(); } catch (err) { console.error("❌ Click threw:", err.message); }

  let timedOut = false;
  await waitForCondition(() => submissionResponse !== null, timeout)
    .catch(() => { timedOut = true; });

  const postErrors          = await scrapeFormErrors(page);
  const urlAfter            = page.url();
  const urlChanged          = urlAfter !== urlBefore;
  const confirmationDetected = await detectConfirmationPage(page);

  const screenshotPath = `${SCREENSHOT_DIR}/submit_${Date.now()}.png`;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot → ${screenshotPath}`);
  } catch (e) {}

  page.off("request",  onRequest);
  page.off("response", onResponse);

  let success = false;
  let reason  = "";

  if (submissionResponse) {
    const s = submissionResponse.status;
    if (s >= 200 && s < 400) { success = true; reason = `Network POST confirmed — HTTP ${s}`; }
    else                     { reason = `Network POST received HTTP ${s} — rejected by server`; }
  } else if (confirmationDetected) {
    success = true;
    reason  = "Confirmation page/element detected in DOM";
  } else if (timedOut && !submissionRequest) {
    reason = "No submission network request detected — form was NOT submitted";
  } else if (timedOut && submissionRequest) {
    reason = "Request sent but no server response within timeout";
  } else {
    reason = "No submission network request detected — form was NOT submitted";
  }

  const newErrors = postErrors.filter(e => !preErrors.some(p => p.text === e.text));
  if (success && newErrors.length > 0) {
    success = false;
    reason += " | Overridden: new DOM validation errors after click";
  }

  console.log("\n========== SUBMISSION RESULT ==========");
  console.log(`Status  : ${success ? "✅ SUCCESS" : "❌ FAILED / UNCONFIRMED"}`);
  console.log(`Reason  : ${reason}`);
  console.log(`Network : request=${!!submissionRequest} | response=${!!submissionResponse} | HTTP=${submissionResponse?.status ?? "none"}`);
  console.log(`URL     : changed=${urlChanged}`);
  if (newErrors.length > 0) {
    const uniqueNew = [...new Set(newErrors.map(e => e.text))];
    console.log("Still unfilled after click:");
    uniqueNew.forEach(t => console.log(`  • ${t}`));
  }
  console.log("========================================\n");

  return { success, reason, httpStatus: submissionResponse?.status ?? null, screenshotPath };
}

/* ─────────────────────────────────────────────
   APPLICATION SUBMISSION
───────────────────────────────────────────── */

async function applyToGreenhouse(page, jobUrl, resumePath) {
  console.log(`🔗 Navigating to: ${jobUrl}`);
  await page.goto(jobUrl, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. Standard personal fields (English + German)
  console.log("📝 Filling standard fields...");
  await fillTextFields(page);
  await checkCheckboxes(page);
  await clickRadioIfRequired(page);

  // 2. AI answers all custom questions
  //    Pass 1 = text inputs (skips any that have a sibling <select>)
  //    Pass 2 = select dropdowns (exclusively handled here)
  console.log("🤖 Scanning for custom questions...");
  const qaLog = await answerCustomQuestions(page);
  console.log(`🤖 Custom questions answered: ${qaLog.length}`);

  // 3. Upload resume
  console.log("📄 Uploading resume...");
  const fileInput = await page.$("input[type='file']");
  if (!fileInput) throw new Error("Resume upload field not found");
  await fileInput.setInputFiles(resumePath);
  await page.waitForTimeout(1000);

  // 4. Find submit button (English + German)
  let submit = await page.$("button[type='submit']");
  if (!submit) submit = await page.$("input[type='submit']");
  if (!submit) submit = await page.$("button:has-text('Submit')");
  if (!submit) submit = await page.$("button:has-text('Apply')");
  if (!submit) submit = await page.$("button:has-text('Send')");
  if (!submit) submit = await page.$("button:has-text('Absenden')");
  if (!submit) submit = await page.$("button:has-text('Bewerben')");
  if (!submit) throw new Error("Submit button not found");

  // 5. Submit with network-layer validation
  console.log("🚀 Clicking submit — monitoring network...");
  const result = await validateSubmission(page, async () => {
    await submit.click();
  });

  if (!result.success) throw new Error(`Submission not confirmed: ${result.reason}`);

  console.log("✅ Application submitted successfully!");
  return { result, qaLog };
}

/* ─────────────────────────────────────────────
   MAIN EXECUTION
───────────────────────────────────────────── */

async function run() {
  const sheets = await getSheetsClient();

  const scoringRows =
    (await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Scoring!A2:J",
    })).data.values || [];

  const intakeRows =
    (await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Job Intake!A2:I",
    })).data.values || [];

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  let appliedCount = 0;

  for (const row of scoringRows) {
    if (appliedCount >= MAX_APPLICATIONS_PER_RUN) break;

    const [jobId, company, role, , decision] = row;
    if (decision !== "APPLY") continue;

    const intake = intakeRows.find(r => r[0] === jobId);
    if (!intake) continue;

    const applyUrl       = intake[4];
    const jobDescription = intake[5];

    if (!applyUrl?.includes("greenhouse.io")) continue;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Applying → ${company} | ${role}`);
    console.log(`${"=".repeat(60)}`);

    const resumePath = await generateResumeForJob(jobId, jobDescription);
    if (!resumePath) { console.log("⚠️ Resume generation failed, skipping..."); continue; }

    try {
      const { result, qaLog } = await applyToGreenhouse(page, applyUrl, resumePath);

      // ✅ Only reaches here on confirmed network-layer submission
      const today              = new Date().toISOString().split("T")[0];
      const responsesForSheet  = formatQAForSheet(qaLog);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Applications!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            jobId,                 // Col A: Job_ID
            company,               // Col B: Company
            role,                  // Col C: Role
            `resume_${jobId}.pdf`, // Col D: Resume_File
            "",                    // Col E: Cover_Letter_File (unused)
            responsesForSheet,     // Col F: Responses ← AI Q&A log
            today,                 // Col G: Application_Date
            "SUBMITTED",           // Col H: Application_Status
            result.reason          // Col I: Notes
          ]]
        }
      });

      console.log(`✅ Application logged to sheet`);
      console.log(`📋 Responses: ${responsesForSheet.substring(0, 120)}...`);
      appliedCount++;

    } catch (err) {
      console.error(`❌ Application failed: ${err.message}`);
      // NOT logging to sheet — submission unconfirmed
    }
  }

  await browser.close();
  console.log(`\n🎯 Applied to ${appliedCount} jobs this run`);
}

run().catch(console.error);
