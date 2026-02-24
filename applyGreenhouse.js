// applyGreenhouse.js

const { google } = require('googleapis');
const sheets = google.sheets('v4');

async function writeApplicationToSheet(application) {
    const auth = await authorize();
    const sheets = google.sheets({version: 'v4', auth});
    const spreadsheetId = 'your-spreadsheet-id'; // Change this to your Spreadsheet ID

    const values = [[
        application.Job_ID,
        application.Company,
        application.Role,
        application.Resume_File,
        application.Cover_Letter_File,
        application.Responses,
        application.Application_Date,
        application.Application_Status,
        application.Notes
    ]];

    const resource = {
        values,
    };

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Applications', // The name of the sheet
        valueInputOption: 'RAW',
        resource,
    });
}

module.exports = writeApplicationToSheet;