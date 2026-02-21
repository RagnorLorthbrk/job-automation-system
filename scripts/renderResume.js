import fs from "fs";

function formatExperience(experienceArray) {
  return experienceArray.map(exp => {
    const achievements = exp.achievements
      .map(a => `<li>${a}</li>`)
      .join("");

    return `
      <div class="experience-block">
        <p class="role-title">${exp.role}</p>
        <p class="company">${exp.company} | ${exp.location} | ${exp.start} - ${exp.end}</p>
        <ul>${achievements}</ul>
      </div>
    `;
  }).join("");
}

function formatEducation(educationArray) {
  return educationArray.map(edu => {
    return `
      <p><strong>${edu.degree}</strong> — ${edu.institution}, ${edu.location} (${edu.year})</p>
    `;
  }).join("");
}

function renderResume() {
  const template = fs.readFileSync("templates/resume_template.html", "utf-8");
  const data = JSON.parse(fs.readFileSync("data/tailored_resume.json", "utf-8"));

  const contactLine = `
${data.personal.phone} | ${data.personal.email} | ${data.personal.location}
${data.personal.work_preferences.join(" | ")}
`;

  let html = template
    .replace("{{name}}", data.personal.name)
    .replace("{{headline}}", data.personal.headline)
    .replace("{{contact_line}}", contactLine)
    .replace("{{linkedin_url}}", data.personal.linkedin)
    .replace("{{summary}}", data.summary)
    .replace("{{experience}}", formatExperience(data.experience))
    .replace("{{education}}", formatEducation(data.education))
    .replace("{{skills_marketing}}", data.skills.marketing.join(", "))
    .replace("{{skills_tools}}", data.skills.tools.join(", "))
    .replace("{{skills_communication}}", data.skills.communication.join(", "))
    .replace("{{skills_analytics}}", data.skills.analytics.join(", "))
    .replace("{{skills_operations}}", data.skills.operations.join(", "))
    .replace("{{skills_languages}}", data.skills.languages.join(", "));

  fs.writeFileSync("output/final_resume.html", html);

  console.log("✅ HTML resume generated.");
}

renderResume();
