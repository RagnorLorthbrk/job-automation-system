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
You are a strict and decisive job suitability evaluator.

Candidate Profile:
${JSON.stringify(masterProfile)}

Job Title:
${job.role}

Job Location:
${job.location}

Job Description:
${job.description}

CANDIDATE CORE IDENTITY:
Senior Digital Marketing Leader with 10+ years experience across B2B and B2C.
Specializations:
- Performance marketing
- Paid media
- CRM automation
- Lifecycle marketing
- Demand generation
- Growth strategy
- Digital strategy leadership
- Budget ownership ($10 to $1M+)
- Multi-industry and global exposure

CRITICAL SCORING RULES:

1) Roles that directly own paid acquisition channels
   (Google Ads, Paid Search, Paid Social, Performance Marketing,
   Growth Marketing, Digital Acquisition) are STRONG matches
   and may score 85-100.

2) Roles with DIRECT ownership of digital marketing strategy, paid acquisition (including paid social), CRM systems, Email marketing, Affiliate Marketing, Google Ads, Search Paid Ads, Payperclick, Reddit ads, Instagram ads, Facebook ads, Tiktok ads, Pinterest ads, lifecycle marketing, demand generation, growth strategy, OR performance-driven social media leadership can score above 80.

3) Social Media Roles:
   - If focused on paid social, acquisition, performance metrics, or growth ownership → may score above 70.
   - If focused on organic content, community engagement, moderation, brand storytelling, or meme strategy → must score below 50.

4) The following roles MUST score BELOW 10:
- Engineering
- Software Development
- DevOps
- HR
- Finance
- Legal
- Admin
- IT
- Data engineering
- Technical architecture
- Security roles
- Non-marketing technical roles
- Field Sales

5) The following roles MUST score BELOW 30:
- Sales
- Business Development
- Account Executive
- Customer Success
- Traditional/offline marketing
- Field sales
- Retail marketing
- Channel sales
- Event-only field marketing
- Non-digital marketing roles

6) Do NOT give partial credit.
If the role is not clearly digital marketing leadership or performance ownership,
score aggressively low.

7) Geographic feasibility:
Only consider suitable if role is global remote OR visa/relocation friendly
for an India-based candidate.

8) Be strict but logically consistent.
Industry (e.g., crypto, SaaS, retail) alone must NOT reduce score.
Only functional misalignment should reduce score.

Respond ONLY in valid JSON:

{
  "fit": true or false,
  "confidence": number (0-100),
  "reason": "short explanation"
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a strict digital marketing job fit evaluator." },
        { role: "user", content: prompt }
      ]
    });

    let content = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(content);

    return {
      fit: Boolean(parsed.fit),
      confidence: Number(parsed.confidence),
      reason: parsed.reason || ""
    };

  } catch (error) {
    console.error("AI evaluation error:", error);
    return { fit: false, confidence: 0, reason: "Evaluation failed" };
  }
}
