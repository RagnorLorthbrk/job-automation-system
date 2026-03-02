/**
 * fetchJobs.js
 * ─────────────────────────────────────────────────────────────────────────
 * Multi-source job intake with ATS detection.
 *
 * STRATEGY:
 *   For every job found we check whether the apply URL resolves to a
 *   supported ATS (Greenhouse, Lever, Workable, Ashby, SmartRecruiters).
 *   Jobs without a supported ATS URL are silently dropped — they cannot
 *   be auto-applied to, so there is no point adding them to the sheet.
 *
 * SOURCES (all free, no API key required):
 *   1. Remotive        — https://remotive.com/api/remote-jobs
 *   2. Jobicy          — https://jobicy.com/api/v2/remote-jobs
 *   3. Greenhouse feed — directly queries greenhouse.io boards for a
 *                        curated list of known marketing-heavy companies
 *   4. RemoteOK        — https://remoteok.com/api (existing source, kept)
 *
 * OUTPUT:
 *   Writes qualifying jobs to "Job Intake" Google Sheet (same schema as
 *   before) with status NEW.  Duplicate external_id values are skipped.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { google } from "googleapis";
import OpenAI from "openai";
import fs from "fs";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const spreadsheetId = "1VLZUQJh-lbzA2K4TtSQALgqgwWmnGmSHngKYQubG7Ng";

// ─── ATS URL patterns we can auto-apply to ────────────────────────────────
const SUPPORTED_ATS = [
  /greenhouse\.io/i,
  /lever\.co/i,
  /workable\.com/i,
  /ashbyhq\.com/i,
  /smartrecruiters\.com/i,
  /jobs\.eu\.greenhouse\.io/i,
  /job-boards\.greenhouse\.io/i,
  /job-boards\.eu\.greenhouse\.io/i,
];

function isSupportedATS(url = "") {
  return SUPPORTED_ATS.some(p => p.test(url));
}

/**
 * Follow redirects on a URL and return the final resolved URL.
 * Used to catch cases where a job board links to a short URL that
 * redirects to e.g. greenhouse.io.
 */
async function resolveUrl(url, timeoutMs = 6000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    clearTimeout(timer);
    return res.url || url;
  } catch {
    return url;
  }
}

/**
 * For a given apply URL:
 * 1. If it already matches a supported ATS → return it as-is.
 * 2. Follow redirects and check the final URL.
 * 3. If still no match → fetch the page body and look for ATS links.
 * Returns the ATS URL if found, or null if not supported.
 */
async function detectATSUrl(applyUrl = "") {
  if (!applyUrl) return null;

  // Direct match
  if (isSupportedATS(applyUrl)) return applyUrl;

  // Follow redirects
  const resolved = await resolveUrl(applyUrl);
  if (isSupportedATS(resolved)) return resolved;

  // Fetch page body and grep for ATS links
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(applyUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = await res.text();
    for (const pattern of SUPPORTED_ATS) {
      const match = html.match(
        new RegExp(`https?://[^"'\\s]*${pattern.source}[^"'\\s]*`, "i")
      );
      if (match) return match[0];
    }
  } catch { /* ignore */ }

  return null;
}

// ─── Role filter (same logic as existing remoteok.js) ────────────────────
const BLOCKED = [
  "engineer","developer","devops","data science","data engineer",
  " hr ","talent acquisition","recruit","legal","finance","accountant",
  "paralegal","architect","it support","field sales","security engineer",
  "nurse","robotics","technician","project manager","product manager",
  "operations manager","customer success","business development",
];
const ALLOWED = [
  "marketing","growth","google ads","bing ads","dv360","facebook ads",
  "instagram ads","reddit ads","ad ops","affiliate","email marketing",
  "paid search","paid social","paid media","demand gen","performance",
  "acquisition","crm","lifecycle","digital","media manager","media lead",
  "media director","media strategist","campaign manager","programmatic",
];

function shouldEvaluate(title = "", description = "") {
  const t = (title + " " + description).toLowerCase();
  if (BLOCKED.some(k => t.includes(k))) return false;
  return ALLOWED.some(k => t.includes(k));
}

// ─── AI fit check ─────────────────────────────────────────────────────────
const masterProfile = JSON.parse(fs.readFileSync("data/master_resume.json", "utf-8"));

async function evaluateJobFit(job) {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a strict digital marketing job fit evaluator." },
        {
          role: "user",
          content: `
Candidate: ${JSON.stringify(masterProfile)}
Job title: ${job.role}
Location: ${job.location}
Description: ${(job.description || "").substring(0, 1500)}

Is this a strong fit for a 10-year senior digital marketing professional
specialising in paid media, performance marketing, CRM, lifecycle, demand gen?

Rules:
- Only consider remote/worldwide/visa-friendly roles.
- Score above 70 only for clear functional digital marketing match.
- Non-marketing roles score below 10.

Respond ONLY as JSON: {"fit": true/false, "confidence": 0-100, "reason": "short"}`,
        },
      ],
    });
    const parsed = JSON.parse(
      res.choices[0].message.content.replace(/```json|```/g, "").trim()
    );
    return { fit: Boolean(parsed.fit), confidence: Number(parsed.confidence), reason: parsed.reason || "" };
  } catch {
    return { fit: false, confidence: 0, reason: "Evaluation failed" };
  }
}

// ─── Google Sheets helpers ────────────────────────────────────────────────
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getExistingIds(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: "Job Intake!A2:A",
  });
  return new Set((res.data.values || []).map(r => r[0]));
}

async function insertJob(sheets, job, existingIds) {
  if (existingIds.has(job.external_id)) {
    console.log(`  ⏭  Duplicate: ${job.external_id}`);
    return false;
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Job Intake!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        job.external_id, job.company, job.role, job.location,
        job.apply_url, (job.description || "").substring(0, 2000),
        job.source, new Date().toISOString(), "NEW",
      ]],
    },
  });
  existingIds.add(job.external_id);
  console.log(`  ✅ Added [${job.source}] ${job.company} — ${job.role}`);
  return true;
}

// ─── Process a single job through the full pipeline ───────────────────────
async function processJob(sheets, existingIds, raw) {
  const { external_id, company, role, location, apply_url, description, source } = raw;

  if (!role) return;

  // 1. Hard keyword filter
  if (!shouldEvaluate(role, description)) {
    console.log(`  🚫 Keyword skip: ${role}`);
    return;
  }

  // 2. ATS URL detection — drop if not supported
  console.log(`  🔍 Checking ATS URL for: ${role} @ ${company}`);
  const atsUrl = await detectATSUrl(apply_url);
  if (!atsUrl) {
    console.log(`  ❌ No supported ATS URL found — skipping`);
    return;
  }
  console.log(`  🔗 ATS URL: ${atsUrl}`);

  // 3. AI fit check
  const fit = await evaluateJobFit({ role, location, description });
  if (!fit.fit || fit.confidence < 65) {
    console.log(`  🤖 AI skip (${fit.confidence}%): ${fit.reason}`);
    return;
  }
  console.log(`  🤖 AI match (${fit.confidence}%): ${fit.reason}`);

  // 4. Insert into sheet
  await insertJob(sheets, {
    external_id, company, role, location,
    apply_url: atsUrl,   // always store the resolved ATS URL
    description, source,
  }, existingIds);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOURCE 1 — Remotive (free API)
// ═══════════════════════════════════════════════════════════════════════════
async function fetchRemotive(sheets, existingIds) {
  console.log("\n📡 Fetching Remotive...");
  try {
    const res = await fetch(
      "https://remotive.com/api/remote-jobs?category=marketing&limit=50",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const { jobs } = await res.json();
    console.log(`  Found ${jobs.length} jobs`);
    for (const j of jobs) {
      await processJob(sheets, existingIds, {
        external_id: "REMOTIVE-" + j.id,
        company:     j.company_name || "",
        role:        j.title        || "",
        location:    j.candidate_required_location || "Remote",
        apply_url:   j.url          || "",
        description: j.description  || "",
        source:      "Remotive",
      });
    }
  } catch (e) {
    console.error("  Remotive error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOURCE 2 — Jobicy (free API)
// ═══════════════════════════════════════════════════════════════════════════
async function fetchJobicy(sheets, existingIds) {
  console.log("\n📡 Fetching Jobicy...");
  try {
    const res = await fetch(
      "https://jobicy.com/api/v2/remote-jobs?count=50&tag=marketing",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    const jobs = data.jobs || [];
    console.log(`  Found ${jobs.length} jobs`);
    for (const j of jobs) {
      await processJob(sheets, existingIds, {
        external_id: "JOBICY-" + j.id,
        company:     j.companyName  || "",
        role:        j.jobTitle     || "",
        location:    j.jobGeo       || "Remote",
        apply_url:   j.url          || "",
        description: j.jobDescription || "",
        source:      "Jobicy",
      });
    }
  } catch (e) {
    console.error("  Jobicy error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOURCE 3 — RemoteOK (existing, kept)
// ═══════════════════════════════════════════════════════════════════════════
async function fetchRemoteOK(sheets, existingIds) {
  console.log("\n📡 Fetching RemoteOK...");
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data = await res.json();
    const jobs = data.slice(1);
    console.log(`  Found ${jobs.length} jobs`);
    for (const j of jobs) {
      await processJob(sheets, existingIds, {
        external_id: "REMOTEOK-" + j.id,
        company:     j.company     || "",
        role:        j.position    || "",
        location:    j.location    || "Remote",
        apply_url:   j.apply_url || j.url || "",
        description: j.description || "",
        source:      "RemoteOK",
      });
    }
  } catch (e) {
    console.error("  RemoteOK error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOURCE 4 — Direct Greenhouse boards for known marketing-heavy companies
//  We query boards.greenhouse.io/[slug]/jobs directly — no API key needed.
// ═══════════════════════════════════════════════════════════════════════════

// Companies known to use Greenhouse and hire for digital marketing roles.
// Add any company slug from their Greenhouse URL here.
const GREENHOUSE_COMPANIES = [
  // Agency / Media networks
  { slug: "wppmedia",       name: "WPP Media" },
  { slug: "publicisgroupe", name: "Publicis Groupe" },
  { slug: "dentsu",         name: "Dentsu" },
  { slug: "havas",          name: "Havas" },
  { slug: "ipgmediabrands", name: "IPG Mediabrands" },
  // AdTech / MarTech
  { slug: "tradedesk",      name: "The Trade Desk" },
  { slug: "doubleverifyin", name: "DoubleVerify" },
  { slug: "integral_ad_science", name: "IAS" },
  { slug: "similarweb",     name: "SimilarWeb" },
  { slug: "semrush",        name: "SEMrush" },
  { slug: "braze",          name: "Braze" },
  { slug: "klaviyo",        name: "Klaviyo" },
  { slug: "hubspot",        name: "HubSpot" },
  { slug: "sprinklr",       name: "Sprinklr" },
  // Global brands with large marketing teams
  { slug: "booking",        name: "Booking.com" },
  { slug: "airbnb",         name: "Airbnb" },
  { slug: "spotify",        name: "Spotify" },
  { slug: "shopify",        name: "Shopify" },
  { slug: "canva",          name: "Canva" },
  { slug: "notion",         name: "Notion" },
  { slug: "figma",          name: "Figma" },
  { slug: "miro",           name: "Miro" },
];

// EU Greenhouse board variants (some companies use eu.greenhouse.io)
const GREENHOUSE_EU_COMPANIES = [
  { slug: "phiture2",  name: "Phiture" },
  { slug: "adjust",    name: "Adjust" },
  { slug: "appsflyerprivatelimited", name: "AppsFlyer" },
  { slug: "adyen",     name: "Adyen" },
  { slug: "personio",  name: "Personio" },
  { slug: "n26",       name: "N26" },
  { slug: "sumup",     name: "SumUp" },
  { slug: "deliveroo", name: "Deliveroo" },
];

async function fetchGreenhouseBoard(slug, company, baseUrl, sheets, existingIds) {
  const apiUrl = `${baseUrl}/${slug}/jobs`;
  try {
    const res = await fetch(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return;
    const { jobs } = await res.json();
    if (!jobs?.length) return;

    for (const j of jobs) {
      // Only look at marketing-relevant departments / titles
      const dept = (j.departments?.[0]?.name || "").toLowerCase();
      const title = (j.title || "").toLowerCase();
      if (!shouldEvaluate(j.title, dept)) continue;

      const applyUrl = `${baseUrl.replace("/v1/boards", "")}/${slug}/jobs/${j.id}`;
      await processJob(sheets, existingIds, {
        external_id: `GH-${slug.toUpperCase()}-${j.id}`,
        company,
        role:        j.title    || "",
        location:    j.location?.name || "Remote",
        apply_url:   applyUrl,
        description: j.content  || "",
        source:      "Greenhouse-Direct",
      });
    }
  } catch (e) {
    // Many slugs may not exist — silently ignore
  }
}

async function fetchGreenhouseDirect(sheets, existingIds) {
  console.log("\n📡 Fetching Greenhouse boards directly...");

  // Standard boards
  for (const { slug, name } of GREENHOUSE_COMPANIES) {
    console.log(`  📋 ${name} (${slug})`);
    await fetchGreenhouseBoard(
      slug, name,
      "https://boards-api.greenhouse.io/v1/boards",
      sheets, existingIds
    );
    await new Promise(r => setTimeout(r, 300)); // rate-limit courtesy
  }

  // EU boards
  for (const { slug, name } of GREENHOUSE_EU_COMPANIES) {
    console.log(`  📋 ${name} EU (${slug})`);
    await fetchGreenhouseBoard(
      slug, name,
      "https://job-boards.eu.greenhouse.io/v1/boards",
      sheets, existingIds
    );
    await new Promise(r => setTimeout(r, 300));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("🚀 Starting multi-source job intake...\n");

  const sheets      = await getSheetsClient();
  const existingIds = await getExistingIds(sheets);
  console.log(`📊 Existing jobs in sheet: ${existingIds.size}`);

  await fetchGreenhouseDirect(sheets, existingIds);  // best quality — direct ATS
  await fetchRemotive(sheets, existingIds);
  await fetchJobicy(sheets, existingIds);
  await fetchRemoteOK(sheets, existingIds);

  console.log("\n✅ Job intake complete.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
