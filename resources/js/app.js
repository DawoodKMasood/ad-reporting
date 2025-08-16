import '../css/app.css'

// Import integrations
try {
  import('./integrations.js');
} catch (e) {
  console.error('Failed to load integrations.js:', e);
}

// Import custom reports
try {
  import('./custom-reports.js');
  console.log('custom-reports.js imported');
} catch (e) {
  console.error('Failed to load custom-reports.js:', e);
}

console.log('Ad Reporting App loaded');