import { google } from "googleapis";

const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

async function testSheets() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: SERVICE_ACCOUNT,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = "PASTE_YOUR_SHEET_ID_HERE";

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Job Intake!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "TEST123",
            "Test Company",
            "Demand Generation Manager",
            "Remote",
            "https://example.com",
            "Test Job Description",
            "Manual",
            new Date().toISOString(),
            "NEW"
          ]
        ],
      },
    });

    console.log("✅ Successfully wrote to Google Sheet.");
  } catch (error) {
    console.error("❌ Sheets Error:", error);
    process.exit(1);
  }
}

testSheets();
