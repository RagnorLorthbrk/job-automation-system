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
- summary_master
- personal.headline_base
- experience[].high_impact_achievements
- add additional skills per section (do NOT remove existing ones)

Return only fields that need modification.
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

    const finalResume = JSON.parse(JSON.stringify(masterResume));

    if (aiChanges.summary_master) {
      finalResume.summary_master = aiChanges.summary_master;
    }

    if (aiChanges.personal?.headline_base) {
      finalResume.personal.headline_base =
        aiChanges.personal.headline_base;
    }

    if (aiChanges.experience) {
      aiChanges.experience.forEach((expChange, index) => {
        if (
          finalResume.experience[index] &&
          expChange.high_impact_achievements
        ) {
          finalResume.experience[index].high_impact_achievements =
            expChange.high_impact_achievements;
        }
      });
    }

    if (aiChanges.skills) {
      Object.keys(aiChanges.skills).forEach((section) => {
        if (finalResume.skills[section]) {
          const staticSkills = finalResume.skills[section];
          const aiSkills = aiChanges.skills[section] || [];

          const merged = [...new Set([...staticSkills, ...aiSkills])];

          finalResume.skills[section] = merged.slice(0, 20);
        }
      });
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
