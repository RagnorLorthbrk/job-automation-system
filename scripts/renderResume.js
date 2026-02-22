import fs from "fs";

function formatExperience(experienceArray = []) {
  return experienceArray.map(exp => {
    const achievements = (exp.high_impact_achievements || [])
      .map(a => `<li>${a}</li>`)
      .join("");

    return `
      <div class="experience-block">
        <p class="role-title">${exp.role || ""}</p>
        <p class="company">
          ${exp.company || ""} | ${exp.location || ""} | ${exp.start || ""} - ${exp.end || ""}
        </p>
        <ul>${achievements}</ul>
      </div>
    `;
  }).join("");
}

function formatEducation(educationArray = []) {
  return educationArray.map(edu => {
    return `
      <p><strong>${edu.degree}</strong> — ${edu.institution}, ${edu.location} (${edu.year})</p>
    `;
  }).join("");
}

function renderResume() {
  const template = fs.readFileSync("templates/resume_template.html", "utf-8");
  const data = JSON.parse(fs.readFileSync("data/tailored_resume.json", "utf-8"));

  const headline =
    data.personal?.headline ||
    data.personal?.headline_base ||
    "";

  const contactLine = `
${data.personal?.phone || ""} | ${data.personal?.email || ""} | ${data.personal?.location || ""}
`;

  const linkedinURL =
    data.personal?.linkedin?.startsWith("http")
      ? data.personal.linkedin
      : data.personal?.linkedin
      ? "https://" + data.personal.linkedin
      : "#";

  const summary = data.summary_master || "";

  const skillsMarketing = (data.skills?.marketing_campaigns || []).join(", ");
  const skillsTools = (data.skills?.tools_platforms || []).join(", ");
  const skillsLeadership = (data.skills?.communications_leadership || []).join(", ");
  const skillsAnalytics = (data.skills?.analytics_data || []).join(", ");
  const skillsOperations = (data.skills?.operations_strategy || []).join(", ");
  const skillsLanguages = (data.skills?.languages || []).join(", ");

  let html = template
    .replace("{{name}}", data.personal?.name || "")
    .replace("{{headline}}", headline)
    .replace("{{contact_line}}", contactLine)
    .replace("{{linkedin_url}}", linkedinURL)
    .replace("{{summary}}", summary)
    .replace("{{experience}}", formatExperience(data.experience))
    .replace("{{education}}", formatEducation(data.education))
    .replace("{{skills_marketing}}", skillsMarketing)
    .replace("{{skills_tools}}", skillsTools)
    .replace("{{skills_communication}}", skillsLeadership)
    .replace("{{skills_analytics}}", skillsAnalytics)
    .replace("{{skills_operations}}", skillsOperations)
    .replace("{{skills_languages}}", skillsLanguages);

  fs.writeFileSync("output/final_resume.html", html);

  console.log("✅ HTML resume generated.");
}

renderResume();
