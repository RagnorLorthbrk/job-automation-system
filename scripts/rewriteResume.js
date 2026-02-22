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

    if (jobDescription.length < 300) {
      fs.writeFileSync(
        "data/tailored_resume.json",
        JSON.stringify(masterResume, null, 2)
      );
      console.log("⚠️ JD too short. Using master resume.");
      return;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
Only modify:
- summary
- personal.headline
- experience[].high_impact_achievements
- skills arrays

DO NOT remove company, location, start, end.
Return JSON with only fields to modify.
`
        },
        {
          role: "user",
          content: `
JOB DESCRIPTION:
${jobDescription}

MASTER RESUME:
${JSON.stringify(masterResume)}
`
        }
      ]
    });

    let content = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const aiChanges = JSON.parse(content);

    const finalResume = { ...masterResume };

    if (aiChanges.summary) {
      finalResume.summary = aiChanges.summary;
    }

    if (aiChanges.personal?.headline) {
      finalResume.personal.headline = aiChanges.personal.headline;
    }

    if (aiChanges.experience) {
      aiChanges.experience.forEach((expChange, index) => {
        if (finalResume.experience[index]) {
          if (expChange.high_impact_achievements) {
            finalResume.experience[index].high_impact_achievements =
              expChange.high_impact_achievements;
          }
        }
      });
    }

    if (aiChanges.skills) {
      finalResume.skills = {
        ...finalResume.skills,
        ...aiChanges.skills
      };
    }

    fs.writeFileSync(
      "data/tailored_resume.json",
      JSON.stringify(finalResume, null, 2)
    );

    console.log("✅ Resume safely rewritten.");
  } catch (err) {
    console.error("Rewrite error:", err);
    process.exit(1);
  }
}

rewriteResume();
