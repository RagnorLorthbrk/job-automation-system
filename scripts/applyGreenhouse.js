import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const MAX_APPLICATIONS_PER_RUN = 2;

async function confirmSubmission(page) {
  // Wait briefly after clicking submit
  await page.waitForTimeout(5000);

  const currentURL = page.url().toLowerCase();
  const pageContent = (await page.content()).toLowerCase();

  // 1️⃣ URL-based confirmation
  if (
    currentURL.includes("thank") ||
    currentURL.includes("submitted") ||
    currentURL.includes("complete")
  ) {
    return true;
  }

  // 2️⃣ Text-based confirmation
  const successPhrases = [
    "thank you for applying",
    "application received",
    "your application has been submitted",
    "thanks for applying",
    "we have received your application",
  ];

  for (const phrase of successPhrases) {
    if (pageContent.includes(phrase)) {
      return true;
    }
  }

  // 3️⃣ Form disappeared check
  const formExists = await page.$("form");
  if (!formExists) {
    return true;
  }

  return false;
}

async function applyToGreenhouse(job) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`Applying → ${job.Company} | ${job.Role}`);

    await page.goto(job.Apply_URL, { waitUntil: "networkidle" });

    // Fill common fields
    await page.fill('input[name="first_name"]', "YourFirstName").catch(() => {});
    await page.fill('input[name="last_name"]', "YourLastName").catch(() => {});
    await page.fill('input[type="email"]', "your@email.com").catch(() => {});
    await page.fill('input[type="tel"]', "1234567890").catch(() => {});
    await page.fill('input[name*="linkedin"]', "https://linkedin.com/in/yourprofile").catch(() => {});

    // Upload resume
    const resumePath = path.resolve(`output/resume_${job.Job_ID}.pdf`);
    if (!fs.existsSync(resumePath)) {
      throw new Error(`Resume file missing: ${resumePath}`);
    }

    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(resumePath);
    }

    // Click submit
    const submitButton =
      (await page.$('button[type="submit"]')) ||
      (await page.$('input[type="submit"]'));

    if (!submitButton) {
      throw new Error("Submit button not found");
    }

    await submitButton.click();

    const success = await confirmSubmission(page);

    if (!success) {
      await page.screenshot({ path: "submission_failure.png", fullPage: true });
      throw new Error("Submission not confirmed");
    }

    console.log("✅ Application successfully submitted.");
  } catch (error) {
    console.error("❌ Application failed:", error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  // Your existing logic to fetch APPLY jobs here
  // Keep your sheet integration logic unchanged

  const jobs = []; // replace with your existing job fetch logic

  let count = 0;
  for (const job of jobs) {
    if (count >= MAX_APPLICATIONS_PER_RUN) break;

    try {
      await applyToGreenhouse(job);
      count++;
    } catch (err) {
      console.error(`Failed job: ${job.Job_ID}`);
    }
  }
}

main();
