import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function rewriteResume() {
  try {
    const masterResume = JSON.parse(
      fs.readFileSync("data/master_resume.json", "utf-8")
    );

    const jobDescription = fs.readFileSync(
      "data/job_description.txt",
      "utf-8"
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `
You are an expert resume optimizer.

CRITICAL RULES:
- Do NOT invent experience.
- Do NOT remove roles.
- Keep job titles exactly as they are in the experience section.
- Do NOT upgrade hierarchical level (no Director, VP, Head unless already in original resume).
- Keep all dates, companies, and roles intact.
- Improve wording for clarity, impact, and alignment with job description.
- Strengthen leadership positioning without exaggeration.
- Output ONLY valid JSON. No markdown. No explanation.
`
        },
        {
          role: "user",
          content: `
TASK:

1) Rewrite the summary to strongly align with the job description.
2) Improve achievement bullets to reflect strategic ownership where accurate.
3) Generate a dynamic professional headline aligned to the JD.

Headline Rules:
- Must be positioning-based, not a job title.
- Must NOT contain Director, VP, Head unless present in original resume.
- Should reflect demand generation, growth, SaaS, digital marketing themes.
- Should be senior and strategic but credible.

Add headline inside personal object like this:

"personal": {
  "name": "...",
  "headline": "...",
  ...
}

JOB DESCRIPTION:
${jobDescription}

MASTER RESUME JSON:
${JSON.stringify(masterResume)}
`
        }
      ]
    });

    let rewritten = response.choices[0].message.content.trim();

    // Clean possible markdown wrapping
    rewritten = rewritten
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(rewritten);

    // Validate headline safety (hard guard)
    if (
      parsed.personal.headline &&
      /(director|vp|head)/i.test(parsed.personal.headline)
    ) {
      parsed.personal.headline = "Demand Generation & Growth Leader";
    }

    fs.writeFileSync(
      "data/tailored_resume.json",
      JSON.stringify(parsed, null, 2)
    );

    console.log("✅ Resume rewritten successfully.");
  } catch (error) {
    console.error("❌ Error rewriting resume:", error);
    process.exit(1);
  }
}

rewriteResume();
