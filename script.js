/* =========================================================
   UjianKu — Aplikasi Kuis Sederhana
   Firebase (Auth + Firestore) via CDN, tanpa build tool.
   ========================================================= */

// ---------- 1. KONFIGURASI FIREBASE ----------
// Ganti dengan konfigurasi proyek Firebase kamu sendiri.
// Firebase Console -> Project settings -> General -> Your apps -> SDK setup and configuration
const firebaseConfig = {
  apiKey: "GANTI_DENGAN_API_KEY",
  authDomain: "GANTI.firebaseapp.com",
  projectId: "GANTI_PROJECT_ID",
  storageBucket: "GANTI.appspot.com",
  messagingSenderId: "GANTI",
  appId: "GANTI"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;

// ---------- 2. STATE ----------
const state = {
  user: null,
  currentQuiz: null,      // { id, title, duration, questionCount }
  questions: [],          // [{id, text, options:[...], order}]
  answers: {},            // { questionId: selectedIndex }
  timerInterval: null,
  secondsLeft: 0,
  submissionId: null,
  tabSwitchCount: 0,
};

// ---------- 3. ELEMENT HELPERS ----------
const $ = (id) => document.getElementById(id);
const views = {
  auth: $('view-auth'),
  dashboard: $('view-dashboard'),
  quiz: $('view-quiz'),
  result: $('view-result'),
};

function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

function showBanner(msg, type = 'info') {
  const b = $('banner');
  const colors = {
    info: 'bg-plum/10 text-plumdark',
    error: 'bg-coral/10 text-coral',
    success: 'bg-mint/10 text-mint',
  };
  b.className = 'mb-4 rounded-xl px-4 py-3 text-sm font-medium ' + colors[type];
  b.textContent = msg;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 4000);
}

// ---------- 4. AUTH: TAB SWITCH UI ----------
$('tabLogin').addEventListener('click', () => {
  $('tabLogin').classList.add('bg-plum', 'text-white');
  $('tabLogin').classList.remove('text-plumdark');
  $('tabRegister').classList.remove('bg-plum', 'text-white');
  $('tabRegister').classList.add('text-plumdark');
  $('formLogin').classList.remove('hidden');
  $('formRegister').classList.add('hidden');
  $('authError').classList.add('hidden');
});

$('tabRegister').addEventListener('click', () => {
  $('tabRegister').classList.add('bg-plum', 'text-white');
  $('tabRegister').classList.remove('text-plumdark');
  $('tabLogin').classList.remove('bg-plum', 'text-white');
  $('tabLogin').classList.add('text-plumdark');
  $('formRegister').classList.remove('hidden');
  $('formLogin').classList.add('hidden');
  $('authError').classList.add('hidden');
});

function authErr(msg) {
  const e = $('authError');
  e.textContent = msg;
  e.classList.remove('hidden');
}

// ---------- 5. AUTH: LOGIN / REGISTER / LOGOUT ----------
$('formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('authError').classList.add('hidden');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    authErr(translateAuthError(err));
  }
});

$('formRegister').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('authError').classList.add('hidden');
  const name = $('regName').value.trim();
  const email = $('regEmail').value.trim();
  const password = $('regPassword').value;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      name, email, createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    authErr(translateAuthError(err));
  }
});

$('btnLogout').addEventListener('click', () => auth.signOut());

function translateAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'Email sudah terdaftar.',
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/weak-password': 'Kata sandi minimal 6 karakter.',
    'auth/user-not-found': 'Email atau kata sandi salah.',
    'auth/wrong-password': 'Email atau kata sandi salah.',
    'auth/invalid-credential': 'Email atau kata sandi salah.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Coba lagi nanti.',
  };
  return map[err.code] || 'Terjadi kesalahan. Coba lagi.';
}

// ---------- 6. AUTH STATE LISTENER ----------
auth.onAuthStateChanged(async (user) => {
  state.user = user;
  if (user) {
    $('userBox').classList.remove('hidden');
    $('userBox').classList.add('flex');
    $('userName').textContent = user.displayName || user.email;
    await loadDashboard();
  } else {
    $('userBox').classList.add('hidden');
    stopTimer();
    showView('auth');
  }
});

// ---------- 7. DASHBOARD ----------
async function loadDashboard() {
  showView('dashboard');
  const listEl = $('quizList');
  listEl.innerHTML = '<p class="text-sm text-ink/50">Memuat kuis...</p>';

  try {
    const snap = await db.collection('quizzes').orderBy('createdAt', 'desc').get();
    if (snap.empty) {
      listEl.innerHTML = '';
      $('quizEmpty').classList.remove('hidden');
      return;
    }
    $('quizEmpty').classList.add('hidden');
    listEl.innerHTML = '';

    for (const doc of snap.docs) {
      const quiz = { id: doc.id, ...doc.data() };
      const subId = `${state.user.uid}_${quiz.id}`;
      const subDoc = await db.collection('submissions').doc(subId).get();
      const done = subDoc.exists && subDoc.data().submitted;

      const card = document.createElement('div');
      card.className = 'bg-white border border-plum/10 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-sm';
      card.innerHTML = `
        <div class="min-w-0">
          <h3 class="font-display font-700 text-plumdark truncate">${escapeHtml(quiz.title || 'Tanpa judul')}</h3>
          <p class="text-xs text-ink/50 mt-0.5">${escapeHtml(quiz.description || '')}</p>
          <div class="flex gap-3 mt-2 text-xs text-ink/60">
            <span>⏱ ${quiz.duration || 0} menit</span>
            <span>📝 ${quiz.questionCount || 0} soal</span>
          </div>
        </div>
        <button data-quiz-id="${quiz.id}" class="btn-start shrink-0 ${done ? 'bg-ink/10 text-ink/50' : 'bg-coral text-white'} font-semibold text-sm px-4 py-2 rounded-xl">
          ${done ? 'Lihat Skor' : 'Mulai'}
        </button>
      `;
      listEl.appendChild(card);

      card.querySelector('.btn-start').addEventListener('click', () => {
        if (done) {
          showFinishedResult(quiz, subDoc.data());
        } else {
          startQuiz(quiz);
        }
      });
    }
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '';
    showBanner('Gagal memuat daftar kuis. Periksa konfigurasi Firebase.', 'error');
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- 8. MULAI KUIS ----------
async function startQuiz(quiz) {
  try {
    const qSnap = await db.collection('quizzes').doc(quiz.id)
      .collection('questions').orderBy('order').get();

    if (qSnap.empty) {
      showBanner('Kuis ini belum memiliki soal.', 'error');
      return;
    }

    state.currentQuiz = quiz;
    state.questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.answers = {};
    state.tabSwitchCount = 0;
    state.submissionId = `${state.user.uid}_${quiz.id}`;

    // Catat waktu mulai (dibuat jika belum ada)
    await db.collection('submissions').doc(state.submissionId).set({
      uid: state.user.uid,
      quizId: quiz.id,
      quizTitle: quiz.title || '',
      submitted: false,
      startedAt: FieldValue.serverTimestamp(),
      totalQuestions: state.questions.length,
    }, { merge: true });

    renderQuiz();
    startTimer((quiz.duration || 10) * 60);
    setupAntiCheat();
    showView('quiz');
  } catch (err) {
    console.error(err);
    showBanner('Gagal memuat soal kuis.', 'error');
  }
}

function renderQuiz() {
  $('quizTitle').textContent = state.currentQuiz.title || 'Kuis';
  $('quizProgress').textContent = `${state.questions.length} soal`;
  const list = $('questionList');
  list.innerHTML = '';

  state.questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    const optionsHtml = (q.options || []).map((opt, i) => `
      <label class="option-label" data-qid="${q.id}" data-idx="${i}">
        <input type="radio" name="q_${q.id}" value="${i}" class="mt-1 accent-plum">
        <span>${escapeHtml(opt)}</span>
      </label>
    `).join('');

    card.innerHTML = `
      <p class="text-xs text-plum font-semibold mb-1">Soal ${idx + 1} dari ${state.questions.length}</p>
      <p class="font-medium mb-3">${escapeHtml(q.text || '')}</p>
      <div class="space-y-2">${optionsHtml}</div>
    `;
    list.appendChild(card);
  });

  // Event listener pilihan jawaban
  list.querySelectorAll('.option-label').forEach(label => {
    label.addEventListener('click', () => {
      const qid = label.dataset.qid;
      const idx = Number(label.dataset.idx);
      state.answers[qid] = idx;

      // highlight visual
      list.querySelectorAll(`.option-label[data-qid="${qid}"]`).forEach(l => l.classList.remove('selected'));
      label.classList.add('selected');
      label.querySelector('input').checked = true;

      $('quizProgress').textContent =
        `${Object.keys(state.answers).length} / ${state.questions.length} soal terjawab`;
    });
  });
}

// ---------- 9. TIMER ----------
function startTimer(totalSeconds) {
  stopTimer();
  state.secondsLeft = totalSeconds;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.secondsLeft--;
    updateTimerDisplay();
    if (state.secondsLeft <= 0) {
      stopTimer();
      showBanner('Waktu habis! Jawaban dikumpulkan otomatis.', 'error');
      submitQuiz(true);
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
}

function updateTimerDisplay() {
  const m = Math.max(0, Math.floor(state.secondsLeft / 60));
  const s = Math.max(0, state.secondsLeft % 60);
  const box = $('timerBox');
  box.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  box.classList.toggle('timer-urgent', state.secondsLeft <= 60);
}

// ---------- 10. ANTI-CHEAT (proteksi dasar di sisi klien) ----------
// Catatan: ini bukan proteksi absolut — hanya mengurangi kemudahan curang.
// Proteksi sesungguhnya (jawaban benar tidak bisa dibaca sebelum submit)
// dilakukan lewat Firestore Security Rules, lihat catatan di README.
let antiCheatBound = false;
function setupAntiCheat() {
  if (antiCheatBound) return;
  antiCheatBound = true;

  document.addEventListener('contextmenu', (e) => {
    if (!views.quiz.classList.contains('hidden')) e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !views.quiz.classList.contains('hidden')) {
      state.tabSwitchCount++;
      $('antiCheatWarning').classList.remove('hidden');
      if (state.submissionId) {
        db.collection('submissions').doc(state.submissionId)
          .set({ tabSwitchCount: state.tabSwitchCount }, { merge: true })
          .catch(() => {});
      }
    }
  });
}

// ---------- 11. SUBMIT & PENILAIAN ----------
$('btnSubmitQuiz').addEventListener('click', () => {
  const answered = Object.keys(state.answers).length;
  const total = state.questions.length;
  if (answered < total) {
    const sisa = total - answered;
    if (!confirm(`Masih ada ${sisa} soal belum dijawab. Tetap kumpulkan?`)) return;
  } else {
    if (!confirm('Kumpulkan jawaban sekarang?')) return;
  }
  submitQuiz(false);
});

async function submitQuiz(auto) {
  stopTimer();
  $('btnSubmitQuiz').disabled = true;
  $('btnSubmitQuiz').textContent = 'Mengirim...';

  try {
    // Langkah 1: kunci jawaban (submitted = true, answers tidak boleh diubah lagi)
    await db.collection('submissions').doc(state.submissionId).set({
      uid: state.user.uid,
      quizId: state.currentQuiz.id,
      quizTitle: state.currentQuiz.title || '',
      answers: state.answers,
      submitted: true,
      submittedAt: FieldValue.serverTimestamp(),
      totalQuestions: state.questions.length,
      auto: !!auto,
    }, { merge: true });

    // Langkah 2: sekarang baru boleh baca kunci jawaban (diizinkan oleh security rules
    // karena dokumen submission sudah submitted = true)
    const keysSnap = await db.collection('quizzes').doc(state.currentQuiz.id)
      .collection('answerKeys').get();

    const keyMap = {};
    keysSnap.forEach(d => { keyMap[d.id] = d.data().correctIndex; });

    let correct = 0;
    const review = [];
    state.questions.forEach(q => {
      const chosen = state.answers[q.id];
      const correctIdx = keyMap[q.id];
      const isCorrect = chosen === correctIdx;
      if (isCorrect) correct++;
      review.push({
        text: q.text,
        options: q.options,
        chosen,
        correctIdx,
        isCorrect,
      });
    });

    const score = Math.round((correct / state.questions.length) * 100);

    // Langkah 3: simpan skor (hanya sekali, rules mencegah penimpaan berulang)
    await db.collection('submissions').doc(state.submissionId).set({
      score,
      correctCount: correct,
    }, { merge: true });

    showResult(state.currentQuiz, score, correct, state.questions.length, review);
  } catch (err) {
    console.error(err);
    showBanner('Gagal mengirim jawaban. Periksa koneksi internet.', 'error');
  } finally {
    $('btnSubmitQuiz').disabled = false;
    $('btnSubmitQuiz').textContent = 'Kumpulkan Jawaban';
  }
}

function showResult(quiz, score, correct, total, review) {
  showView('result');
  $('resultQuizTitle').textContent = quiz.title || '';
  $('resultScore').textContent = score;
  $('resultDetail').textContent = `${correct} dari ${total} soal terjawab benar`;

  const box = $('resultReview');
  box.innerHTML = '';
  review.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = `question-card ${r.isCorrect ? 'review-correct' : 'review-wrong'}`;
    const chosenText = (r.chosen !== undefined && r.options[r.chosen] !== undefined)
      ? r.options[r.chosen] : '(tidak dijawab)';
    const correctText = r.options[r.correctIdx] !== undefined ? r.options[r.correctIdx] : '-';
    div.innerHTML = `
      <p class="text-xs text-ink/50 mb-1">Soal ${i + 1}</p>
      <p class="font-medium mb-2">${escapeHtml(r.text || '')}</p>
      <p class="text-sm">Jawabanmu: <span class="${r.isCorrect ? 'text-mint' : 'text-coral'} font-semibold">${escapeHtml(chosenText)}</span></p>
      ${!r.isCorrect ? `<p class="text-sm text-ink/70">Jawaban benar: <span class="font-semibold">${escapeHtml(correctText)}</span></p>` : ''}
    `;
    box.appendChild(div);
  });
}

async function showFinishedResult(quiz, subData) {
  // Ambil ulang soal untuk ditampilkan pada halaman review
  try {
    const qSnap = await db.collection('quizzes').doc(quiz.id)
      .collection('questions').orderBy('order').get();
    const questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const keysSnap = await db.collection('quizzes').doc(quiz.id)
      .collection('answerKeys').get();
    const keyMap = {};
    keysSnap.forEach(d => { keyMap[d.id] = d.data().correctIndex; });

    const review = questions.map(q => {
      const chosen = (subData.answers || {})[q.id];
      const correctIdx = keyMap[q.id];
      return { text: q.text, options: q.options, chosen, correctIdx, isCorrect: chosen === correctIdx };
    });

    showResult(quiz, subData.score ?? 0, subData.correctCount ?? 0, questions.length, review);
  } catch (err) {
    console.error(err);
    showBanner('Gagal memuat detail hasil.', 'error');
  }
}

$('btnBackDashboard').addEventListener('click', () => {
  $('antiCheatWarning').classList.add('hidden');
  loadDashboard();
});
