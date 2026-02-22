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
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
You are an expert SaaS resume optimizer.

CRITICAL RULES:
- You MUST preserve the exact JSON structure provided.
- You MUST NOT remove any keys.
- You MUST NOT remove education.
- You MUST NOT remove skills categories.
- You MUST NOT remove work_preferences.
- You MUST NOT change role names, companies, or dates.
- Only improve summary, headline, achievements, and skills depth.
- Output complete valid JSON.
`
        },
        {
          role: "user",
          content: `
JOB DESCRIPTION:
${jobDescription}

MASTER RESUME JSON:
${JSON.stringify(masterResume, null, 2)}

Rewrite the resume to better align with the job description while preserving structure.
`
        }
      ]
    });

    let rewritten = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(rewritten);

    // Safety: ensure missing fields fallback to master
    parsed.education = parsed.education || masterResume.education;
    parsed.skills = parsed.skills || masterResume.skills;
    parsed.personal.work_preferences =
      parsed.personal.work_preferences || masterResume.personal.work_preferences;

    fs.writeFileSync(
      "data/tailored_resume.json",
      JSON.stringify(parsed, null, 2)
    );

    console.log("✅ Resume rewritten safely.");
  } catch (error) {
    console.error("❌ Rewrite error:", error);
    process.exit(1);
  }
}

rewriteResume();
