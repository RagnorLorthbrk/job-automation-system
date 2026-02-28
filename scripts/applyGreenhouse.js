import { google } from "googleapis";
import { chromium } from "playwright";
import OpenAI from "openai";
import fs from "fs";
import { execSync } from "child_process";

const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";
const MAX_APPLICATIONS_PER_RUN = 2;

if (!process.env.OPENAI_API_KEY) { console.error("❌ OPENAI_API_KEY missing"); process.exit(1); }
if (!process.env.GOOGLE_SERVICE_ACCOUNT) { console.error("❌ GOOGLE_SERVICE_ACCOUNT missing"); process.exit(1); }

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const master = JSON.parse(fs.readFileSync("data/master_resume.json", "utf-8"));

const FIRST_NAME          = master.personal.name.split(" ")[0];
const LAST_NAME           = master.personal.name.split(" ").slice(1).join(" ");
const EMAIL               = master.personal.email;
const PHONE               = master.personal.phone;
const LINKEDIN            = master.personal.linkedin;
const RESUME_DISPLAY_NAME = "Manoj_Kumar_CV.pdf";

const SCREENSHOT_DIR = "output/screenshots";
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── Fields AI must NEVER touch ──────────────────────────────────────────────
const BLOCKED_FIELD_SIGNALS = [
  "recaptcha", "g-recaptcha", "captcha",
  "honeypot", "bot", "trap", "token", "csrf",
  "trusting", "adroit", "sonstiges", "utm_", "__jv",
];

// ─── Standard personal fields handled deterministically ──────────────────────
const STANDARD_FIELD_SIGNALS = [
  "first name", "first_name", "firstname",
  "last name", "last_name", "lastname",
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
async function getLabelText(elHandle) {
  return elHandle.evaluate(node => {
    // 1. Try label[for="id"]
    if (node.id) {
      const lbl = document.querySelector(`label[for="${node.id}"]`);
      if (lbl) return lbl.innerText.trim();
      // Also check aria-labelledby (React Select pattern)
      const labelledBy = node.getAttribute("aria-labelledby");
      if (labelledBy) {
        const lblEl = document.getElementById(labelledBy);
        if (lblEl) return lblEl.innerText.trim();
      }
    }
    // 2. Walk up parents
    let parent = node.parentElement;
    let depth = 0;
    while (parent && depth < 8) {
      const lbl = parent.querySelector("label");
      if (lbl && !lbl.contains(node)) return lbl.innerText.trim();
      const legend = parent.querySelector("legend");
      if (legend) return legend.innerText.trim();
      parent = parent.parentElement;
      depth++;
    }
    return "";
  });
}

/* ─────────────────────────────────────────────
   REACT SELECT INTERACTION
   These are NOT <select> elements. They are
   custom React dropdowns with role="combobox".
   Interaction: click → type search term →
   wait for option list → click best match.
───────────────────────────────────────────── */

/**
 * Fills a single React Select combobox.
 * @param {Page} page - Playwright page
 * @param {ElementHandle} inputEl - The <input role="combobox"> element
 * @param {string} searchTerm - Text to type to filter options
 * @param {string} questionText - Full question for logging
 * @returns {string|null} - The text of the option that was selected
 */
async function fillReactSelect(page, inputEl, searchTerm, questionText) {
  try {
    // Click the input to open the dropdown
    await inputEl.click();
    await page.waitForTimeout(400);

    // Clear any existing value and type search term
    await inputEl.fill("");
    await inputEl.type(searchTerm, { delay: 50 });
    await page.waitForTimeout(600);

    // Wait for the option list to appear
    const listbox = await page.waitForSelector(
      '[role="listbox"], .select__menu, .select__option',
      { timeout: 3000 }
    ).catch(() => null);

    if (!listbox) {
      console.log(`   ⚠️ No dropdown appeared for "${questionText}" after typing "${searchTerm}"`);
      // Try clearing and clicking again
      await inputEl.fill("");
      await inputEl.click();
      await page.waitForTimeout(500);
      await inputEl.type(searchTerm, { delay: 50 });
      await page.waitForTimeout(600);
    }

    // Find all visible options
    const options = await page.$$('[role="option"], .select__option');
    if (options.length === 0) {
      console.log(`   ⚠️ No options found for "${questionText}"`);
      // Press Escape to close and move on
      await inputEl.press("Escape");
      return null;
    }

    // Click the first matching option (case-insensitive partial match)
    let clicked = null;
    for (const opt of options) {
      const text = await opt.innerText().catch(() => "");
      if (text.toLowerCase().includes(searchTerm.toLowerCase())) {
        await opt.click();
        clicked = text.trim();
        break;
      }
    }

    // If no partial match, click the first option
    if (!clicked && options.length > 0) {
      const text = await options[0].innerText().catch(() => "");
      await options[0].click();
      clicked = text.trim();
    }

    await page.waitForTimeout(300);
    return clicked;
  } catch (err) {
    console.log(`   ❌ React Select error for "${questionText}": ${err.message}`);
    try { await page.keyboard.press("Escape"); } catch (e) {}
    return null;
  }
}

/**
 * Determines the best search term for a React Select dropdown
 * based on the question and candidate profile.
 */
async function getBestReactSelectTerm(questionText, jobDescription) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `
You are filling out a job application for this candidate:
${JSON.stringify(master)}

JOB DESCRIPTION: ${jobDescription}

You will receive a dropdown question. Return ONLY a short search term (1-3 words) 
to type into the dropdown to find the right option.

RULES:
- For yes/no questions where candidate has the skill → return: Yes
- For yes/no questions where candidate does NOT have the skill → return: No
- Candidate HAS: Google Ads, Apple Search Ads (ASA), Meta Ads, LinkedIn Ads, TikTok,
  Snapchat, Pinterest, Reddit, Programmatic (DV360), CRM, HubSpot, Marketo, Salesforce,
  ABM, demand gen, performance marketing, paid search, paid social, affiliate, email marketing.
- For region/location → return: Asia (or the most relevant region option for India)
- For GDPR/consent/agreement → return: Yes
- For notice period / start date → return: Immediately (or the shortest option text)
- For work type → return: Full time
- Respond with ONLY the search term. Nothing else.
`
        },
        { role: "user", content: `Question: ${questionText}` }
      ]
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    return "Yes"; // safe fallback
  }
}

/* ─────────────────────────────────────────────
   STANDARD FIELD FILLING
───────────────────────────────────────────── */
async function fillTextFields(page) {
  const inputs = await page.$$(
    "input[type='text'], input[type='email'], input[type='tel'], textarea"
  );
  for (const input of inputs) {
    try {
      // Skip React Select comboboxes — handled separately
      const role = await input.getAttribute("role");
      if (role === "combobox") continue;

      const name        = ((await input.getAttribute("name"))        || "").toLowerCase();
      const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
      const id          = ((await input.getAttribute("id"))          || "").toLowerCase();
      const labelText   = (await getLabelText(input)).toLowerCase();
      const combined    = `${name} ${placeholder} ${id} ${labelText}`;

      if (isBlocked(combined)) continue;

      const val = await input.inputValue().catch(() => "");
      if (val && val.trim()) continue;

      if      (/first.?name|firstname|vorname/.test(combined))    await input.fill(FIRST_NAME).catch(() => {});
      else if (/last.?name|lastname|nachname/.test(combined))     await input.fill(LAST_NAME).catch(() => {});
      else if (/e-?mail/.test(combined))                          await input.fill(EMAIL).catch(() => {});
      else if (/phone|telefon|mobile|handynummer/.test(combined)) await input.fill(PHONE).catch(() => {});
      else if (/linkedin/.test(combined))                         await input.fill(LINKEDIN).catch(() => {});
    } catch (e) {}
  }
}

async function checkCheckboxes(page) {
  const checkboxes = await page.$$("input[type='checkbox']");
  for (const box of checkboxes) {
    try {
      const name = ((await box.getAttribute("name")) || "").toLowerCase();
      const id   = ((await box.getAttribute("id"))   || "").toLowerCase();
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
   NATIVE <SELECT> FILLING
───────────────────────────────────────────── */
async function fillNativeSelects(page, jobDescription) {
  const selects = await page.$$("select");
  const qaLog = [];

  for (const select of selects) {
    try {
      const name      = ((await select.getAttribute("name")) || "").toLowerCase();
      const id        = ((await select.getAttribute("id"))   || "").toLowerCase();
      const labelText = await getLabelText(select);
      const combined  = `${name} ${id} ${labelText.toLowerCase()}`;

      if (isBlocked(combined)) continue;

      const options = await select.evaluate(el =>
        Array.from(el.options).map(o => ({ value: o.value, text: o.text.trim() }))
          .filter(o => o.value && o.text && !/^select|^choose|^auswählen|^wählen\s|^--/i.test(o.text))
      );
      if (options.length === 0) continue;

      const currentVal = await select.evaluate(el => el.value);
      if (currentVal && currentVal.trim() && currentVal !== "0") continue;

      const questionText = labelText || name;
      if (!questionText || questionText.trim().length < 3) continue;

      console.log(`🤖 AI selecting (native select): "${questionText}"`);
      const bestOption = await pickBestNativeSelectOption(questionText, options, jobDescription);

      if (bestOption) {
        await select.selectOption(bestOption).catch(() => {});
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

async function pickBestNativeSelectOption(question, options, jobDescription) {
  try {
    const optionsList = options.map(o => `value="${o.value}" text="${o.text}"`).join("\n");
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Pick the best option for this candidate. Respond ONLY with the exact value string.
Candidate: ${JSON.stringify(master)}
Rules: yes/no → Yes if skill in profile; notice/start → shortest/immediate; work type → Full Time; GDPR → Yes; location → India/Asia/remote.
Candidate HAS: Google Ads, Apple Search Ads (ASA), Meta Ads, LinkedIn Ads, TikTok, Snapchat, Pinterest, Reddit, Programmatic (DV360), CRM, HubSpot, Marketo, Salesforce, ABM, performance marketing, paid search, paid social, email marketing.`
        },
        { role: "user", content: `Question: ${question}\nOptions:\n${optionsList}\nRespond with ONLY the value string.` }
      ]
    });
    const picked = response.choices[0].message.content.trim().replace(/^"|"$/g, "");
    return options.find(o => o.value === picked) ? picked : options[0].value;
  } catch (err) {
    return options[0]?.value || null;
  }
}

/* ─────────────────────────────────────────────
   AI QUESTION ANSWERING
   Handles both React Select and plain text inputs
───────────────────────────────────────────── */
async function answerCustomQuestions(page) {
  const jobDescription = fs.existsSync("data/job_description.txt")
    ? fs.readFileSync("data/job_description.txt", "utf-8")
    : "";

  const qaLog = [];

  // ── PASS 1: React Select comboboxes (role="combobox") ────────────────────
  const comboboxes = await page.$$('input[role="combobox"]');
  console.log(`🔍 Found ${comboboxes.length} React Select combobox(es)`);

  for (const input of comboboxes) {
    try {
      const id        = ((await input.getAttribute("id"))   || "").toLowerCase();
      const labelText = await getLabelText(input);
      const combined  = `${id} ${labelText.toLowerCase()}`;

      if (isBlocked(combined))  { console.log(`🚫 Blocked combobox: "${labelText}"`); continue; }
      if (isStandard(combined)) continue;

      const questionText = labelText;
      if (!questionText || questionText.trim().length < 3) continue;

      // Check if already has a selected value (container will show the value text)
      const hasValue = await input.evaluate(node => {
        const container = node.closest(".select__container, .select-shell, [class*='container']");
        if (!container) return false;
        const valueEl = container.querySelector(".select__single-value, [class*='singleValue']");
        return valueEl ? valueEl.innerText.trim().length > 0 : false;
      });
      if (hasValue) { console.log(`   ⏭️ Already has value, skipping: "${questionText}"`); continue; }

      console.log(`🤖 AI selecting (React Select): "${questionText}"`);
      const searchTerm = await getBestReactSelectTerm(questionText, jobDescription);
      console.log(`   🔎 Searching for: "${searchTerm}"`);

      const selectedText = await fillReactSelect(page, input, searchTerm, questionText);

      if (selectedText) {
        qaLog.push({ question: questionText, answer: selectedText });
        console.log(`   ✅ Selected: "${selectedText}"`);
      } else {
        console.log(`   ⚠️ Could not select option for "${questionText}"`);
      }

      // Brief pause between dropdowns
      await page.waitForTimeout(400);
    } catch (e) {
      console.log(`   ❌ Combobox error: ${e.message}`);
    }
  }

  // ── PASS 2: Native <select> elements ─────────────────────────────────────
  const nativeQA = await fillNativeSelects(page, jobDescription);
  qaLog.push(...nativeQA);

  // ── PASS 3: Plain text inputs / textareas ────────────────────────────────
  const inputs = await page.$$("input[type='text'], input[type='url'], textarea");

  for (const input of inputs) {
    try {
      // Skip comboboxes — already handled above
      const role = await input.getAttribute("role");
      if (role === "combobox") continue;

      const name        = ((await input.getAttribute("name"))        || "").toLowerCase();
      const placeholder = ((await input.getAttribute("placeholder")) || "").toLowerCase();
      const id          = ((await input.getAttribute("id"))          || "").toLowerCase();
      const labelText   = await getLabelText(input);
      const combined    = `${name} ${placeholder} ${id} ${labelText.toLowerCase()}`;

      if (isBlocked(combined))  { console.log(`🚫 Blocked text: "${labelText || name}"`); continue; }
      if (isStandard(combined)) continue;

      const currentVal = await input.inputValue().catch(() => "");
      if (currentVal && currentVal.trim()) continue;

      const questionText = labelText || placeholder || name;
      if (!questionText || questionText.trim().length < 3) continue;

      console.log(`🤖 AI answering (text): "${questionText}"`);
      const answer = await generateAIAnswer(questionText, jobDescription);

      if (answer) {
        await input.fill(answer).catch(() => {});
        qaLog.push({ question: questionText, answer });
        console.log(`   ✅ "${answer.substring(0, 80)}${answer.length > 80 ? "..." : ""}"`);
      }
    } catch (e) {}
  }

  return qaLog;
}

/* ─────────────────────────────────────────────
   OPENAI TEXT ANSWER
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
You are filling out a job application for this candidate.
CANDIDATE: ${JSON.stringify(master)}
JOB: ${jobDescription}

RULES:
- Answer ONLY the question. No preamble, labels, or "Answer:".
- yes/no → "Yes" or "No" only.
- notice period / start date / when can you join → "Immediately."
- salary → "Open to discussion based on the role and total package."
- work authorization / visa → "I am based in India and open to fully remote roles globally."
- city/location → "New Delhi, India."
- country → "India."
- why work here → 2-3 sentences using the job description.
- hobby/fun fact → 1-2 sentences from profile.
- how did you find us → "Through an online job board."
- Candidate HAS: Google Ads, Apple Search Ads (ASA), Meta Ads, LinkedIn Ads, TikTok,
  Snapchat, Pinterest, Reddit, Programmatic (DV360), CRM, HubSpot, Marketo, Salesforce,
  ABM, demand gen, performance marketing, paid search, paid social, affiliate, email marketing.
- For skill questions above → "Yes." For skills NOT listed → "No."
- If German question → answer in German.
- Keep concise (1-4 sentences).
`
        },
        { role: "user", content: `Question: ${question}` }
      ]
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error(`❌ AI text failed for "${question}":`, err.message);
    return null;
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
      '.field_with_errors', '[data-error]', '.alert-danger', '[role="alert"]',
    ];
    const errors = [];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const text = el.innerText?.trim();
        if (text) errors.push({ selector: sel, text });
      });
    });
    document.querySelectorAll("input, select, textarea").forEach(field => {
      if (field.getAttribute("role") === "combobox") return; // React Select always shows invalid until filled
      if (!field.validity.valid) {
        errors.push({ text: field.validationMessage || "Field invalid", fieldName: field.name });
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

function waitForCondition(fn, timeout) {
  return new Promise((resolve, reject) => {
    const interval = 200;
    let elapsed = 0;
    const t = setInterval(() => {
      if (fn()) { clearInterval(t); resolve(); }
      else { elapsed += interval; if (elapsed >= timeout) { clearInterval(t); reject(); } }
    }, interval);
  });
}

async function detectConfirmationPage(page) {
  return page.evaluate(() => {
    const phrases = [
      "application received", "thank you for applying", "successfully submitted",
      "your application has been", "we have received", "thanks for applying",
      "next steps", "what happens next", "we'll be in touch",
      "bewerbung erhalten", "vielen dank", "erfolgreich eingereicht",
    ];
    const selectors = [
      '[class*="confirmation"]', '[class*="success"]', '[class*="thank"]',
      '[id*="confirmation"]', '[id*="success"]', '.submission-success',
    ];
    const body = document.body.innerText.toLowerCase();
    return phrases.some(p => body.includes(p)) || selectors.some(s => !!document.querySelector(s));
  });
}

async function validateSubmission(page, clickAction, timeout = 15000) {
  let submissionRequest = null;
  let submissionResponse = null;

  const onRequest = req => {
    if ((req.method() === "POST" || req.method() === "PUT") &&
        GREENHOUSE_SUBMISSION_PATTERNS.some(re => re.test(req.url()))) {
      submissionRequest = { url: req.url(), method: req.method() };
      console.log(`🌐 [Network] Submission request → ${req.url()}`);
    }
  };
  const onResponse = res => {
    if (submissionRequest && res.url() === submissionRequest.url && !submissionResponse) {
      submissionResponse = { status: res.status() };
      console.log(`🌐 [Network] Submission response → HTTP ${res.status()}`);
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  const preErrors = await scrapeFormErrors(page);
  if (preErrors.length > 0) {
    const unique = [...new Set(preErrors.map(e => e.text))];
    console.warn(`⚠️ Pre-click unfilled fields (${unique.length}):`);
    unique.slice(0, 5).forEach(t => console.warn(`   • ${t}`));
  }

  const urlBefore = page.url();
  try { await clickAction(); } catch (err) { console.error("❌ Click threw:", err.message); }

  let timedOut = false;
  await waitForCondition(() => submissionResponse !== null, timeout).catch(() => { timedOut = true; });

  const postErrors  = await scrapeFormErrors(page);
  const urlChanged  = page.url() !== urlBefore;
  const confirmed   = await detectConfirmationPage(page);

  const screenshotPath = `${SCREENSHOT_DIR}/submit_${Date.now()}.png`;
  try { await page.screenshot({ path: screenshotPath, fullPage: true }); console.log(`📸 Screenshot → ${screenshotPath}`); } catch (e) {}

  page.off("request", onRequest);
  page.off("response", onResponse);

  let success = false;
  let reason  = "";

  if (submissionResponse) {
    const s = submissionResponse.status;
    if (s >= 200 && s < 400) { success = true; reason = `Network POST confirmed — HTTP ${s}`; }
    else { reason = `Network POST received HTTP ${s} — rejected by server`; }
  } else if (confirmed) {
    success = true; reason = "Confirmation page detected in DOM";
  } else if (timedOut) {
    reason = submissionRequest
      ? "Request sent but no server response within timeout"
      : "No submission network request detected — form was NOT submitted";
  }

  const newErrors = postErrors.filter(e => !preErrors.some(p => p.text === e.text));
  if (success && newErrors.length > 0) {
    success = false;
    reason += " | Overridden: new validation errors after click";
  }

  console.log("\n========== SUBMISSION RESULT ==========");
  console.log(`Status  : ${success ? "✅ SUCCESS" : "❌ FAILED / UNCONFIRMED"}`);
  console.log(`Reason  : ${reason}`);
  console.log(`Network : request=${!!submissionRequest} | response=${!!submissionResponse} | HTTP=${submissionResponse?.status ?? "none"}`);
  console.log(`URL     : changed=${urlChanged}`);
  if (newErrors.length > 0) {
    const unique = [...new Set(newErrors.map(e => e.text))];
    console.log("Still unfilled after click:");
    unique.forEach(t => console.log(`  • ${t}`));
  }
  console.log("========================================\n");

  return { success, reason, httpStatus: submissionResponse?.status ?? null };
}

/* ─────────────────────────────────────────────
   APPLICATION SUBMISSION
───────────────────────────────────────────── */
async function applyToGreenhouse(page, jobUrl, resumePath) {
  console.log(`🔗 Navigating to: ${jobUrl}`);
  await page.goto(jobUrl, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(2500); // Let React components fully mount

  // 1. Standard personal fields
  console.log("📝 Filling standard fields...");
  await fillTextFields(page);
  await checkCheckboxes(page);
  await clickRadioIfRequired(page);
  await page.waitForTimeout(500);

  // 2. AI handles all custom questions:
  //    - React Select comboboxes (click+type+select)
  //    - Native <select> elements
  //    - Plain text inputs
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
  const result = await validateSubmission(page, () => submit.click());

  if (!result.success) throw new Error(`Submission not confirmed: ${result.reason}`);

  console.log("✅ Application submitted successfully!");
  return { result, qaLog };
}

/* ─────────────────────────────────────────────
   MAIN EXECUTION
───────────────────────────────────────────── */
async function run() {
  const sheets = await getSheetsClient();

  const scoringRows = (await sheets.spreadsheets.values.get({
    spreadsheetId, range: "Scoring!A2:J",
  })).data.values || [];

  const intakeRows = (await sheets.spreadsheets.values.get({
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

      const today             = new Date().toISOString().split("T")[0];
      const responsesForSheet = formatQAForSheet(qaLog);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Applications!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            jobId, company, role, RESUME_DISPLAY_NAME, "",
            responsesForSheet, today, "SUBMITTED", result.reason
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
