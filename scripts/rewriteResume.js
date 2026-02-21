import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function rewriteResume() {
  try {
    // Read master resume
    const masterResume = JSON.parse(
      fs.readFileSync("data/master_resume.json", "utf-8")
    );

    // Read job description
    const jobDescription = fs.readFileSync(
      "data/job_description.txt",
      "utf-8"
    );

    const prompt = `
You are an expert resume optimizer.

Rewrite the provided resume JSON to better match the job description.

RULES:
- Do NOT invent experience.
- Do NOT remove roles.
- Keep JSON structure identical.
- Rewrite summary and achievements for relevance.
- Prioritize keywords from the job description.
- Improve clarity and impact.
- Output valid JSON only.

JOB DESCRIPTION:
${jobDescription}

MASTER RESUME JSON:
${JSON.stringify(masterResume, null, 2)}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You rewrite resumes professionally." },
        { role: "user", content: prompt }
      ],
      temperature: 0.4
    });

    const rewritten = response.choices[0].message.content;

    // Save tailored resume
    fs.writeFileSync("data/tailored_resume.json", rewritten);

    console.log("✅ Resume rewritten successfully.");
  } catch (error) {
    console.error("❌ Error rewriting resume:", error);
  }
}

rewriteResume();
