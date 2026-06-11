import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAUvIZVOGQedPuAeHeGv2tBN0jfdebHrCc",
  authDomain: "painel-admin-murylo-bio.firebaseapp.com",
  projectId: "painel-admin-murylo-bio",
  storageBucket: "painel-admin-murylo-bio.firebasestorage.app",
  messagingSenderId: "497494776604",
  appId: "1:497494776604:web:982de5f354b145a61eb8d9"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
