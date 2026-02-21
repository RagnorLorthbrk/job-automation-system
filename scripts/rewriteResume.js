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
          content: "You are an expert resume optimizer. Output ONLY valid JSON. No markdown. No explanations."
        },
        {
          role: "user",
          content: `
Rewrite the provided resume JSON to better match the job description.

RULES:
- Do NOT invent experience.
- Do NOT remove roles.
- Keep JSON structure identical.
- Rewrite summary and achievements for relevance.
- Prioritize keywords from the job description.
- Improve clarity and impact.

Return ONLY raw JSON.

JOB DESCRIPTION:
${jobDescription}

MASTER RESUME JSON:
${JSON.stringify(masterResume)}
`
        }
      ]
    });

    let rewritten = response.choices[0].message.content.trim();

    // 🔥 CLEAN MARKDOWN IF MODEL STILL ADDS IT
    rewritten = rewritten
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(rewritten);

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
