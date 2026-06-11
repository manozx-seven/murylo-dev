import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyAUvIZVOGQedPuAeHeGv2tBN0jfdebHrCc",
  authDomain: "painel-admin-murylo-bio.firebaseapp.com",
  projectId: "painel-admin-murylo-bio",
  storageBucket: "painel-admin-murylo-bio.firebasestorage.app",
  messagingSenderId: "497494776604",
  appId: "1:497494776604:web:982de5f354b145a61eb8d9"
};

const app = initializeApp(firebaseConfig);

// experimentalAutoDetectLongPolling: detecta proxies/firewalls corporativos
// (ex.: rede do tribunal) que bloqueiam o streaming padrão do Firestore e
// que faziam as escritas ficarem "salvando eternamente". Com long-polling
// automático a conexão funciona mesmo atrás desses proxies.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Firebase Authentication (login real por e-mail/senha). A persistência padrão
// é "local": a sessão sobrevive a reloads e novas abas sem código extra.
export const auth = getAuth(app);

// Garante que nenhuma operação do Firestore trave a interface para sempre.
// Se o servidor não responder em `ms`, rejeita com erro "timeout:<label>".
// Para escritas isso é seguro: o dado já fica no cache local e sincroniza depois.
export function withTimeout(promise, ms = 8000, label = 'op') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const isTimeout = err => String(err?.message || '').startsWith('timeout');
