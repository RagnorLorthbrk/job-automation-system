function applyGreenhouse(formResponses) {
    const sheet = SpreadsheetApp.openById('YOUR_SPREADSHEET_ID').getSheetByName('Applicant');
    const rows = formResponses.map(response => [
        response.Job_ID,
        response.Company,
        response.Role,
        response.Resume_File,
        response.Cover_Letter_File,
        JSON.stringify(response.Responses),
        new Date().toISOString().slice(0, 19).replace('T', ' '), // Application_Date
        'Pending', // Application_Status
        '' // Notes
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}