import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function rewriteResume() {
  try {
    const master = JSON.parse(
      fs.readFileSync("data/master_resume.json", "utf-8")
    );

    const jd = fs.readFileSync("data/job_description.txt", "utf-8");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: `
You are an expert enterprise SaaS resume strategist.

Rules:
- Do NOT change company, location, start, end, or education.
- Deeply enhance summary.
- Rewrite ALL high_impact_achievements per role.
- Each role must have 5–8 bullets.
- Bullets must be strong, impact-driven, and quantified (%, $, X growth where logical).
- Bullets must be medium length (not 1 line, not paragraphs).
- Expand skills per section to 12–20 relevant items aligned to JD.
- Keep language executive and data-backed.
Return FULL resume JSON preserving structure.
`
        },
        {
          role: "user",
          content: `
JOB DESCRIPTION:
${jd}

MASTER RESUME:
${JSON.stringify(master)}
`
        }
      ]
    });

    let content = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const enhanced = JSON.parse(content);

    // Lock structural fields
    enhanced.education = master.education;

    enhanced.experience = enhanced.experience.map((exp, index) => ({
      ...master.experience[index],
      high_impact_achievements:
        exp.high_impact_achievements ||
        master.experience[index].high_impact_achievements
    }));

    fs.writeFileSync(
      "data/tailored_resume.json",
      JSON.stringify(enhanced, null, 2)
    );

    console.log("✅ Resume deeply enhanced.");
  } catch (err) {
    console.error("Rewrite error:", err);
    process.exit(1);
  }
}

rewriteResume();
