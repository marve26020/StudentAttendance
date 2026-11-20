/* ==========================================================================
   js/config.js — App-wide settings
   --------------------------------------------------------------------------
   THIS IS THE ONE PLACE TO EDIT YOUR BRANDING.
   Change the values below and they update the navigation bar, the login page
   and the title of the printed PDF automatically.
   ========================================================================== */

export const APP_CONFIG = {
  // Shown in the top navigation bar and at the top of the PDF.
  schoolName: "Your School Name",

  // Shown under the school name in the navigation bar and in the PDF title.
  programName: "Student Work Aid Program",

  // Your logo. Replace images/logo.png with your own file (keep the name),
  // or change the path here. If the file is missing we fall back to
  // images/logo.svg so nothing looks broken.
  logoPath: "images/schoolLogo (1).png",
  logoFallback: "images/logo.svg",

  // Optional: pre-fills the supervisor name line on the printed PDF.
  // Leave empty ('') to keep it blank for a handwritten signature.
  supervisorName: "",

  // The downloaded PDF file is named like: Attendance-November-2026.pdf
  pdfFileNamePrefix: "Attendance",
};
