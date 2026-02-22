import OpenAI from "openai";
import fs from "fs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const masterProfile = JSON.parse(
  fs.readFileSync("data/master_resume.json", "utf-8")
);

export async function scoreJob(job) {
  const prompt = `
You are evaluating a job match deeply and strategically.

Candidate Profile:
${JSON.stringify(masterProfile)}

Job Title:
${job.role}

Job Description:
${job.description}

TASK:

1) Give a match score from 0-100 based on:
   - Skill alignment
   - Seniority alignment
   - Budget ownership alignment
   - Channel expertise overlap
   - Strategic ownership level

2) Decide:
   APPLY or SKIP

3) Provide:
   - Top strengths aligned with the role
   - Gaps or weaker alignment areas
   - Specific resume tailoring suggestions to improve chances

Be analytical and honest.
Industry alone should not reduce score.
Functional misalignment should.

Respond ONLY in valid JSON:

{
  "match_score": number,
  "apply_decision": "APPLY" or "SKIP",
  "strengths": ["..."],
  "gaps": ["..."],
  "resume_tailoring_advice": ["..."]
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a senior hiring strategist evaluating candidate-job fit." },
        { role: "user", content: prompt }
      ]
    });

    let content = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(content);

  } catch (error) {
    console.error("Scoring error:", error);
    return {
      match_score: 0,
      apply_decision: "SKIP",
      strengths: [],
      gaps: [],
      resume_tailoring_advice: []
    };
  }
}
