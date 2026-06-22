import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyCr83rXRbphXAZ3VWVeDSM_UJ5-TsUY_xQ",
  authDomain: "painel-admin-bio.firebaseapp.com",
  projectId: "painel-admin-bio",
  storageBucket: "painel-admin-bio.firebasestorage.app",
  messagingSenderId: "371618139088",
  appId: "1:371618139088:web:ce4f1bd686f9295cdb87d5"
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
