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
You are an expert enterprise SaaS resume strategist.

CRITICAL RULES:
- Do NOT invent fake companies or roles.
- Do NOT upgrade hierarchy (no Director/VP unless in original resume).
- Keep dates, companies, and role names unchanged.
- Strengthen strategic positioning.
- Expand bullet points to 5–6 per role.
- Make each bullet impact-driven and quantified when possible.
- Expand skills to 15–20 relevant items per category where appropriate.
- Align strongly with the job description.
- Output ONLY valid JSON.
`
        },
        {
          role: "user",
          content: `
TASK:

1) Rewrite summary aligned to the job description.
2) Generate a dynamic strategic headline (not hierarchical).
3) Expand each role to 5–6 strong impact bullets.
4) Expand skill categories significantly while keeping relevance.

JOB DESCRIPTION:
${jobDescription}

MASTER RESUME JSON:
${JSON.stringify(masterResume)}
`
        }
      ]
    });

    let rewritten = response.choices[0].message.content.trim();

    rewritten = rewritten
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(rewritten);

    // Safety guard for headline inflation
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
