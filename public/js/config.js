// =====================================================================
// App configuration - the only file you normally need to edit.
// These values are public by design (they ship to every browser).
// Security comes from firestore.rules + Firebase Auth, not from hiding them.
// The app name and logo shown to users are set inside the app (Admin > Branding);
// appName below is only the fallback before that's loaded.
// =====================================================================
window.APP_CONFIG = {
    appName: "Showbase",

    firebase: {
        apiKey: "AIzaSyAraFqQWYbeAf1NoRikNpyBYF98rvyxjKo",
        authDomain: "starpac-audio.firebaseapp.com",
        projectId: "starpac-audio",
        storageBucket: "starpac-audio.firebasestorage.app",
        messagingSenderId: "714621922543",
        appId: "1:714621922543:web:12f66b6598c029a88eff1a"
    },

    // Google Sheets one-way backup.
    // Paste the Apps Script Web App URL here (ends in /exec). Leave "" to switch the backup off.
    sheetsWebAppUrl: "https://script.google.com/macros/s/AKfycbzZwt86B8fnIWW4CttSEI0j7L8aSbttZM7TZYY-EhIcs5boJVj2mipRltR4KoO1jWou/exec",

    // Username sign-in (used by the host / primary Admin). Typing a name without "@" signs in as
    // <name with spaces as dots>@usernameDomain, e.g. "Starpacsound Admin" -> starpacsound.admin@showbase.local.
    // Nobody can sign up with this domain. Must match USERNAME_DOMAIN in apps-script/Code.gs.
    usernameDomain: "showbase.local",

    // Shows Google Sheet + booking emails: Apps Script web app bound to the SHOWS Sheet (apps-script/shows/Code.gs).
    // A different Sheet + script from the inventory backup. Leave "" to run without it (everything still works in the app).
    showsWebAppUrl: "https://script.google.com/macros/s/AKfycbzQ-QEyKjIeA25feqjW2PNOWpcmsCVTFmpCX3nkoMUeDqDIt1uviCSPZy-Q7_X14K4W/exec",
    // Crew role columns in Availability › Team (Admins / Co-Admins tick them there).
    crewRoles: ["SE", "ST", "CRS", "NEW"],
    // How many months ahead people can mark availability.
    availMonthsAhead: 6,

    // A repair still "Repairing" after this many days is flagged as overdue.
    repairOverdueDays: 14,

    // Loans: earliest collection date = submission date + this many days.
    loanNoticeDays: 2
};
