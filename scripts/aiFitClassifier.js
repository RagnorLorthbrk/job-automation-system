import OpenAI from "openai";
import fs from "fs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const masterProfile = JSON.parse(
  fs.readFileSync("data/master_resume.json", "utf-8")
);

export async function evaluateJobFit(job) {
  const prompt = `
You are evaluating job suitability.

Candidate Profile:
${JSON.stringify(masterProfile)}

Job Title:
${job.role}

Job Location:
${job.location}

Job Description:
${job.description}

Task:
Determine if this role is a strong strategic fit.

Consider:
- Alignment with senior digital marketing leadership roles
- Performance marketing, paid media, CRM automation, lifecycle marketing
- Demand generation, acquisition, and growth ownership
- Multi-industry relevance (B2B or B2C acceptable)
- Budget responsibility and strategic ownership
- Geographic feasibility for an India-based candidate (must be global remote or visa supported)

Respond ONLY in valid JSON:

{
  "fit": true or false,
  "confidence": number (0-100),
  "reason": "short explanation"
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: "You are a strict job fit evaluator." },
      { role: "user", content: prompt }
    ]
  });

  let content = response.choices[0].message.content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(content);
  } catch (err) {
    console.error("AI JSON parse error:", content);
    return { fit: false, confidence: 0, reason: "Invalid AI output" };
  }
}
