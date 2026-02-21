import { execSync } from "child_process";

try {
  console.log("🔄 Rewriting resume...");
  execSync("node scripts/rewriteResume.js", { stdio: "inherit" });

  console.log("🔄 Rendering HTML...");
  execSync("node scripts/renderResume.js", { stdio: "inherit" });

  console.log("🔄 Generating PDF...");
  execSync("node scripts/generatePDF.js", { stdio: "inherit" });

  console.log("🎉 Resume generation complete.");
} catch (error) {
  console.error("❌ Pipeline failed:", error);
}
