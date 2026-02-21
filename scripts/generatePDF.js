import { chromium } from "playwright";

async function generatePDF() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`file://${process.cwd()}/output/final_resume.html`, {
    waitUntil: "networkidle"
  });

  await page.pdf({
    path: "output/resume_output.pdf",
    format: "A4",
    printBackground: true
  });

  await browser.close();
  console.log("✅ PDF generated.");
}

generatePDF();
