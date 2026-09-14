// =====================================================
// FIREBASE CONFIGURATION
// =====================================================
// This file is shared across all pages.
// Do not modify the config values unless you change Firebase projects.

const firebaseConfig = {
    apiKey: "AIzaSyDydTDF5_DOC3BDH6YAbkcNu_NT0qmRcTc",
    authDomain: "nepplaygaming.firebaseapp.com",
    projectId: "nepplaygaming",
    storageBucket: "nepplaygaming.firebasestorage.app",
    messagingSenderId: "893565645520",
    appId: "1:893565645520:web:09d4cb4069dae55d6ee4d5",
    measurementId: "G-3PXN38XFG9"
};

// Firebase SDK imports (loaded via CDN in HTML files)
// This config object is used by every page on the platform.

console.log("🔥 Firebase config loaded for project:", firebaseConfig.projectId);
