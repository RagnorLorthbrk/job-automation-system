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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const master = JSON.parse(fs.readFileSync("data/master_resume.json", "utf-8"));

const FIRST_NAME   = master.personal.name.split(" ")[0];
const LAST_NAME    = master.personal.name.split(" ").slice(1).join(" ");
const EMAIL        = master.personal.email;
const PHONE        = master.personal.phone;
const LINKEDIN     = master.personal.linkedin;

// Clean consistent resume filename shown to every recruiter
const RESUME_DISPLAY_NAME = "Manoj_Kumar_CV.pdf";

const SCREENSHOT_DIR = "output/screenshots";
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── Fields AI must NEVER touch ──────────────────────────────────────────────
const BLOCKED_FIELD_SIGNALS = [
  "recaptcha", "g-recaptcha", "captcha",
  "honeypot", "bot", "trap",
  "token", "csrf",
  "trusting", "adroit",
  "sonstiges",
  "utm_", "__jv",
];

// ─── Standard personal fields — filled deterministically ─────────────────────
const STANDARD_FIELD_SIGNALS = [
  "first name", "first_name", "firstname",
  "last name",  "last_name",  "lastname",
  "email", "e-mail",
  "phone", "telephone", "mobile",
  "linkedin",
  "resume", "cv", "attach", "upload", "cover letter",
  "vorname", "nachname", "telefon", "lebenslauf", "anschreiben",
];

function isBlocked(s)  { return BLOCKED_FIELD_SIGNALS.some(sig => s.includes(sig)); }
function isStandard(s) { return STANDARD_FIELD_SIGNALS.some(sig => s.includes(sig)); }

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
    // Always save as Manoj_Kumar_CV.pdf — clean name for recruiters
    const newFile = `output/${RESUME_DISPLAY_NAME}`;
    if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
    fs.renameSync("output/resume_output.pdf", newFile);
    return newFile;
  } catch (err) {
    console.error("❌ Resume generation failed:", err.message);
    return null;
  }
}

/* ─────────────────────────────────────────────
   LABEL EXTRACTION
───────────────────────────────────────────── */

/**
 * Gets the visible label text for any form element.
 * Walks up through multiple parent levels to find it.
 */
async function getLabelText(elHandle) {
  return elHandle.evaluate(node => {
    // 1. Try explicit label[for="id"]
    if (node.id) {
      const lbl = document.querySelector(`label[for="${node.id}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    // 2. Walk up through parents looking for a label
    let parent = node.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      const lbl = parent.querySelector("label");
      if (lbl && !lbl.contains(node)) return lbl.innerText.trim();
      // Also check for legend (used in fieldsets)
      const legend = parent.querySelector("legend");
      if (legend) return legend.innerText.trim();
      parent = parent.parentElement;
      depth++;
    }
    return "";
  });
}

/* ─────────────────────────────────────────────
   STANDARD FIELD FILLING (English + German)
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

      const val = await input.inputValue().catch(() => "");
      if (val && val.trim()) continue;

      if      (/first.?name|firstname|vorname/.test(combined))     await input.fill(FIRST_NAME).catch(() => {});
      else if (/last.?name|lastname|nachname/.test(combined))      await input.fill(LAST_NAME).catch(() => {});
      else if (/e-?mail/.test(combined))                           await input.fill(EMAIL).catch(() => {});
      else if (/phone|telefon|mobile|handynummer/.test(combined))  await input.fill(PHONE).catch(() => {});
      else if (/linkedin/.test(combined))                          await input.fill(LINKEDIN).catch(() => {});
    } catch (e) {}
  }
}

async function checkCheckboxes(page) {
  const checkboxes = await page.$$("input[type='checkbox']");
  for (const box of checkboxes) {
    try {
      const name     = ((await box.getAttribute("name")) || "").toLowerCase();
      const id       = ((await box.getAttribute("id"))   || "").toLowerCase();
      if (isBlocked(`${name} ${id}`)) continue;
      const checked = await box.isChecked().catch(() => false);
      if (!checked) await box.check().catch(() => {});
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
      const checked = await first.isChecked().catch(() => false);
      if (!checked) await first.check().catch(() => {});
    } catch (e) {}
  }
}

/* ─────────────────────────────────────────────
   DETECT ALL FORM FIELDS WITH THEIR TYPE
   Build a map of every question on the page
   so we can route each one correctly.
───────────────────────────────────────────── */

/**
 * Scans the entire form and returns an array of field descriptors:
 * { type: 'select'|'text'|'textarea', element, questionText, combined }
 * 
 * This is the KEY fix: we build the full field map first,
 * then process each field by its ACTUAL element type —
 * so a select's label never accidentally routes to a text fill.
 */
async function buildFieldMap(page) {
  const fields = [];

  // ── Collect all selects ──────────────────────────────────────────────────
  const selects = await page.$$("select");
  for (const el of selects) {
    try {
      const name      = ((await el.getAttribute("name")) || "").toLowerCase();
      const id        = ((await el.getAttribute("id"))   || "").toLowerCase();
      const labelText = await getLabelText(el);
      const combined  = `${name} ${id} ${labelText.toLowerCase()}`;
      fields.push({ type: "select", element: el, questionText: labelText || name, combined });
    } catch (e) {}
  }

  // ── Collect all text inputs / textareas ──────────────────────────────────
  const inputs = await page$$$(page,
    "input[type='text'], input[type='url'], input[type='number'], textarea"
  );
  for (const el of inputs) {
    try {
      const name        = ((await el.getAttribute("name"))        || "").toLowerCase();
      const placeholder = ((await el.getAttribute("placeholder")) || "").toLowerCase();
      const id          = ((await el.getAttribute("id"))          || "").toLowerCase();
      const labelText   = await getLabelText(el);
      const combined    = `${name} ${placeholder} ${id} ${labelText.toLowerCase()}`;

      // CRITICAL: skip this text input if there is a <select> anywhere
      // in the same ancestor chain (up to 6 levels) — the select handler owns that question
      const hasSelectSibling = await el.evaluate(node => {
        let p = node.parentElement;
        let depth = 0;
        while (p && depth < 6) {
          if (p.querySelector("select")) return true;
          p = p.parentElement;
          depth++;
        }
        return false;
      });
      if (hasSelectSibling) continue;

      fields.push({ type: "text", element: el, questionText: labelText || placeholder || name, combined });
    } catch (e) {}
  }

  return fields;
}

// Helper: page.$$ wrapper with selector
async function page$$$(page, selector) {
  return page.$$(selector);
}

/* ─────────────────────────────────────────────
   AI QUESTION ANSWERING
───────────────────────────────────────────── */

async function answerCustomQuestions(page) {
  const jobDescription = fs.existsSync("data/job_description.txt")
    ? fs.readFileSync("data/job_description.txt", "utf-8")
    : "";

  const qaLog = [];
  const fields = await buildFieldMap(page);

  for (const field of fields) {
    try {
      const { type, element, questionText, combined } = field;

      if (isBlocked(combined))  { console.log(`🚫 Blocked: "${questionText}"`); continue; }
      if (isStandard(combined)) continue;
      if (!questionText || questionText.trim().length < 3) continue;

      if (type === "select") {
        // ── Handle <select> dropdown ───────────────────────────────────────
        const options = await element.evaluate(el => {
          return Array.from(el.options)
            .map(o => ({ value: o.value, text: o.text.trim() }))
            .filter(o =>
              o.value &&
              o.text &&
              !/^select|^choose|^auswählen|^wählen\s|^--/i.test(o.text)
            );
        });
        if (options.length === 0) continue;

        const currentVal = await element.evaluate(el => el.value);
        if (currentVal && currentVal.trim() && currentVal !== "0") continue;

        console.log(`🤖 AI selecting (dropdown): "${questionText}"`);
        const bestOption = await pickBestSelectOption(questionText, options, jobDescription);

        if (bestOption) {
          await element.selectOption(bestOption).catch(() => {});
          // Fire change + input events so React/Vue frameworks register the value
          await element.evaluate(el => {
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("input",  { bubbles: true }));
          });
          await new Promise(r => setTimeout(r, 300)); // brief pause for React state update
          const selectedText = options.find(o => o.value === bestOption)?.text || bestOption;
          qaLog.push({ question: questionText, answer: selectedText });
          console.log(`   ✅ Selected: "${selectedText}"`);
        }

      } else {
        // ── Handle text input / textarea ───────────────────────────────────
        const currentVal = await element.inputValue().catch(() => "");
        if (currentVal && currentVal.trim()) continue;

        console.log(`🤖 AI answering (text): "${questionText}"`);
        const answer = await generateAIAnswer(questionText, jobDescription);

        if (answer) {
          await element.fill(answer).catch(() => {});
          qaLog.push({ question: questionText, answer });
          console.log(`   ✅ "${answer.substring(0, 80)}${answer.length > 80 ? "..." : ""}"`);
        }
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

ANSWER RULES — follow these exactly:
- Answer ONLY the question. No preamble, no "Answer:", no labels.
- For yes/no questions: answer "Yes" or "No" only.
- For notice period / when can you start / earliest start date → answer: "Immediately."
- For salary/compensation → "Open to discussion based on the role and total package."
- For work authorization / visa / right to work → "I am based in India and open to fully remote roles globally."
- For location/city → "New Delhi, India."
- For country → "India."
- For "why do you want to work here" → 2-3 sentences using the job description.
- For hobby/fun fact → 1-2 genuine sentences from the candidate profile.
- For "how did you find us" / source → "Through an online job board."
- For experience questions about skills listed in the profile → answer "Yes."
  The candidate has experience with: Google Ads, Meta Ads, LinkedIn Ads, TikTok, Snapchat,
  Pinterest, Reddit, Programmatic (DV360), CRM, HubSpot, Marketo, Salesforce, ABM,
  demand generation, performance marketing, paid search, paid social, affiliate marketing,
  email marketing, lifecycle marketing, marketing automation.
- For experience questions about skills NOT in the profile → answer "No."
- Never fabricate metrics not in the candidate profile.
- If the question is in German, answer in German.
- Keep answers concise (1-4 sentences unless clearly a long-form essay).
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

SELECTION RULES:
- Pick the option that best represents the candidate for this question.
- For yes/no dropdowns: pick Yes if the skill/experience is in the profile, No otherwise.
  Candidate HAS experience with: Google Ads, Meta Ads, LinkedIn Ads, TikTok, Snapchat,
  Pinterest, Reddit, Programmatic (DV360), CRM, HubSpot, Marketo, Salesforce, ABM,
  demand generation, performance marketing, paid search, paid social, affiliate marketing,
  email marketing, lifecycle marketing, marketing automation, Apple Search Ads (ASA).
- For notice period / start date dropdowns: pick the option closest to "Immediately" or shortest notice.
- For work type dropdowns (full time / part time): pick Full Time / Vollzeit.
- For location/region: pick the option that matches India or remote/global.
- For GDPR/consent dropdowns: pick Yes / Ja / I agree / I consent.
- Respond ONLY with the exact value string. Nothing else. No quotes.
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
    return valid ? picked : options[0].value;
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

  const postErrors           = await scrapeFormErrors(page);
  const urlAfter             = page.url();
  const urlChanged           = urlAfter !== urlBefore;
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
    else { reason = `Network POST received HTTP ${s} — rejected by server`; }
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

  // 1. Standard personal fields
  console.log("📝 Filling standard fields...");
  await fillTextFields(page);
  await checkCheckboxes(page);
  await clickRadioIfRequired(page);

  // 2. AI handles all custom questions
  //    buildFieldMap() ensures each question is routed to its correct element type
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
  if (!submit) submit = await page.$("button:has-text('Bewerbung einreichen')");
  if (!submit) throw new Error("Submit button not found");

  // 5. Network-layer validated submit
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
      const today             = new Date().toISOString().split("T")[0];
      const responsesForSheet = formatQAForSheet(qaLog);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Applications!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            jobId,                 // Col A: Job_ID
            company,               // Col B: Company
            role,                  // Col C: Role
            RESUME_DISPLAY_NAME,   // Col D: Resume_File — always Manoj_Kumar_CV.pdf
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
    }
  }

  await browser.close();
  console.log(`\n🎯 Applied to ${appliedCount} jobs this run`);
}

run().catch(console.error);
