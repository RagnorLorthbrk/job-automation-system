// Debug Script for Greenhouse Applications

const fs = require('fs');
const axios = require('axios');

// Function to capture form inputs and values
function captureFormInputs() {
    const inputs = document.querySelectorAll('form input, form select, form textarea');
    let formData = {};
    inputs.forEach(input => {
        formData[input.name] = input.value;
    });
    return formData;
}

// Function to capture success messages
function captureSuccessMessages() {
    const messages = document.querySelectorAll('.success-message');
    return Array.from(messages).map(msg => msg.innerText);
}

// Function to log network requests
function logNetworkRequests() {
    const originalFetch = window.fetch;
    const originalXhrOpen = XMLHttpRequest.prototype.open;

    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        console.log('Fetch Request:', args, 'Response:', response);
        return response;
    };

    XMLHttpRequest.prototype.open = function (method, url) {
        this.addEventListener('load', function () {
            console.log('XHR Request:', method, url, 'Response:', this.response);
        });
        return originalXhrOpen.apply(this, arguments);
    };
}

// Function to generate JSON report
function generateReport() {
    const report = {
        timestamp: new Date().toISOString(),
        formInputs: captureFormInputs(),
        successMessages: captureSuccessMessages(),
        networkLogs: []
    };
    return report;
}

// Function to save report to a JSON file
function saveReport(report) {
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync('debug_report.json', json);
    console.log('Report saved:', json);
}

// Main execution
function main() {
    logNetworkRequests();
    const report = generateReport();
    saveReport(report);
}

main();
