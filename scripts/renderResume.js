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

  const summary = data.summary || data.summary_master || "";

  const skillsDemand = (data.skills?.demand_generation || []).join(", ");
  const skillsTools = (data.skills?.tools_platforms || []).join(", ");
  const skillsLeadership = (data.skills?.leadership_operations || []).join(", ");

  let html = template
    .replace("{{name}}", data.personal?.name || "")
    .replace("{{headline}}", headline)
    .replace("{{contact_line}}", contactLine)
    .replace("{{linkedin_url}}", linkedinURL)
    .replace("{{summary}}", summary)
    .replace("{{experience}}", formatExperience(data.experience))
    .replace("{{education}}", "") // no education section in this schema
    .replace("{{skills_marketing}}", skillsDemand)
    .replace("{{skills_tools}}", skillsTools)
    .replace("{{skills_communication}}", skillsLeadership)
    .replace("{{skills_analytics}}", "")
    .replace("{{skills_operations}}", "")
    .replace("{{skills_languages}}", "");

  fs.writeFileSync("output/final_resume.html", html);

  console.log("✅ HTML resume generated.");
}

renderResume();
