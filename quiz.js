/* ══════════════════════════════════════════════════════════════════════════════
   quiz.js  —  Bayesian MCQ engine
   Reads questions from data.json. Uses linked probability sliders and a
   proper scoring rule to reward honest confidence estimates.
══════════════════════════════════════════════════════════════════════════════ */


/* ── SCORING FORMULA ────────────────────────────────────────────────────────── */

/* ── SLIDER BOUNDS ────────────────────────────────────
   0% and 100% are forbidden: a Bayesian agent should never be absolutely
   certain (Cromwell's rule). For n answers the max any single answer can
   hold is 1 − (n−1)×MIN, so that the others can each have at least MIN.
──────────────────────────────────────────────────── */
const SLIDER_MIN = 0.01;   // 1 %
const SLIDER_MAX = 0.99;   // 99 %

function sliderMax(n) { return 1 - (n - 1) * SLIDER_MIN; }



/*   Swap this single function to change the scoring rule.

   Arguments:
     p_correct  : float in (0, 1] — probability the student assigned to the
                  correct answer
     n          : int — total number of answer choices

   Returns a score in [0, 100].

   Current rule: NORMALISED LOGARITHMIC (log score)
   ─────────────────────────────────────────────────
   Raw log score = ln(p_correct).
     • Maximum:  ln(1)     = 0   (student was 100% confident and right)
     • Baseline: ln(1/n)   < 0   (student spread probability equally = no info)
     • Minimum:  ln(ε) → -∞     (student was 100% confident and WRONG)

   We normalise so that:
     • Equal spread (no info)    →  0 pts
     • Perfectly correct         → 100 pts
     • Overconfident and wrong   → negative pts (can go very low)

   This is a PROPER scoring rule: the only strategy that maximises your
   *expected* score is to report your genuine beliefs.
────────────────────────────────────────────────────────────────────────────── */
function scoringRule(p_correct, n) {
  //const epsilon  = 0.001;                    // avoid log(0)
  //const p        = Math.max(p_correct, epsilon);
  const baseline = Math.log(1 / n);            // score of a uniform guess
  const best     = Math.log(sliderMax(n));             // = 0, score of a perfect answer
  const raw      = Math.log(p_correct);

  // Linear map: baseline → 0, best → 100
  return ((raw - baseline) / (best - baseline)) * 100;
}


/* ── STATE ───────────────────────────────────────────────────────────────────── */
let allTopics  = [];      // full data from data.json
let questions   = [];
let answered    = 0;
let totalScore  = 0;
// probs[qi] = Float32Array of current slider values for question qi
const probs     = {};

/* ── BOOTSTRAP ───────────────────────────────────────────────────────────────── */
fetch('data.json')
  .then(r => { if (!r.ok) throw new Error('Could not load data.json'); return r.json(); })
  .then(data => { allTopics = data;  showHome(); })
  .catch(err => {
    document.getElementById('home').innerHTML =
      `<p class="load-error">⚠️ ${err.message}</p>`;
  });

/* ── HOME SCREEN - topic selection ──────────────────────────────────────────────────────────────────── */


function showHome() {
  setView('home');

  const grid = document.getElementById('topicGrid');
  grid.innerHTML = '';

  allTopics.forEach((topic, ti) => {
    const card = document.createElement('button');
    card.className = 'topic-card';
    card.style.animationDelay = (ti * 0.07) + 's';
    card.innerHTML = `
      <span class="topic-num">${String(ti + 1).padStart(2, '0')}</span>
      <span class="topic-title">${topic.title}</span>
      <span class="topic-count">${topic.questions.length} question${topic.questions.length > 1 ? 's' : ''}</span>
    `;
    card.addEventListener('click', () => startTopic(ti));
    grid.appendChild(card);
  });

  // Trigger MathJax on topic titles (they may contain LaTeX)
  typesetIfReady('#topicGrid');
}

/* ── RENDER ──────────────────────────────────────────────────────────────────── */
function startTopic(ti) {
  to = allTopics[ti]
  questions  = to.questions;
  answered   = 0;
  totalScore = 0;

  document.getElementById('quizTopicTitle').textContent = allTopics[ti].title;
  document.getElementById('resultPanel').classList.remove('show');

  const enonce = document.getElementById('enonce');
  if (to.texte != '') {
      enonce.innerHTML = `${to.texte}`;
  } else {
      enonce.innerHTML= '';
      //enonce.style.display = 'none';
  }
  typesetIfReady('#enonce');
    
  setView('quiz');
  renderQuestions();
}

function backToHome() {
  setView('home');
  // Re-render home in case MathJax needs a nudge after DOM changes
  typesetIfReady('#topicGrid');
}


function renderQuestions() {
  const container = document.getElementById('questionsContainer');
  container.innerHTML = '';
  answered   = 0;
  totalScore = 0;
  updateScoreBar();

  questions.forEach((q, qi) => {
    const n = q.answers.length;
    const isTF =  isTrueFalse(q);

    // Initialise uniform distribution
    probs[qi] = new Array(n).fill(1 / n);

    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `card-${qi}`;
    card.setAttribute('data-n', qi + 1);
    card.style.animationDelay = (qi * 0.07) + 's';

    card.innerHTML = `
      <div class="question-text">${q.text}</div>
      ${isTF ? renderTrueFalse(qi) : renderSliders(qi, q)}
      <div class="slider-hint">Déplace le${n > 2 ? 's' : ''} curseur${n > 2 ? 's' : ''} pour indiquer ton niveau de confiance puis confirme.</div>
      <button class="btn-confirm" onclick="confirmAnswer(${qi})">Confirmer</button>
      <div class="feedback" id="fb-${qi}"></div>
    `;
    container.appendChild(card);

    // Wire up sliders after insertion
    if (isTF) {
      wireTrueFalse(qi);
    } else {
      wireSliders(qi, n);
    }
  });

    updateProgress();
    typesetIfReady('#questionsContainer');
}

/* ── TRUE / FALSE LAYOUT ─────────────────────────────────────────────────────
   One slider for P(True); P(False) updates automatically.
────────────────────────────────────────────────────────────────────────────── */
function isTrueFalse(q) {
  return q.answers.length === 2 &&
    q.answers[0].toLowerCase() === 'true' &&
    q.answers[1].toLowerCase() === 'false';
}

function renderTrueFalse(qi) {
  return `
    <div class="tf-wrap">
      <div class="tf-labels">
        <span class="tf-label false-label">Faux</span>
        <span class="tf-label true-label">Vrai</span>
      </div>
      <div class="tf-slider-row">
        <div class="tf-pct" id="pct-false-${qi}">50%</div>
        <input type="range" class="slider tf-slider" id="tf-${qi}"
               min="1" max="99" value="50" step="1">
        <div class="tf-pct" id="pct-true-${qi}">50%</div>
      </div>
      <!--<div class="tf-bar-wrap">
        <div class="tf-bar-false" id="bar-false-${qi}" style="width:50%"></div>
        <div class="tf-bar-true"  id="bar-true-${qi}"  style="width:50%"></div>
      </div>-->
    </div>`;
}

function wireTrueFalse(qi) {
  document.getElementById(`tf-${qi}`).addEventListener('input', function() {
    const pTrue  = this.value / 100;
    const pFalse = 1 - pTrue;
    probs[qi][0] = pTrue;
    probs[qi][1] = pFalse;
    document.getElementById(`pct-true-${qi}`).textContent  = pct(pTrue);
    document.getElementById(`pct-false-${qi}`).textContent = pct(pFalse);
    document.getElementById(`bar-true-${qi}`).style.width  = pct(pTrue);
    document.getElementById(`bar-false-${qi}`).style.width = pct(pFalse);
  });
}

/* ── N-ANSWER LINKED SLIDERS ─────────────────────────────────────────────────
   Moving one slider redistributes the remaining probability
   proportionally among the others.
────────────────────────────────────────────────────────────────────────────── */
function renderSliders(qi, q) {
  const n = q.answers.length;
  return q.answers.map((ans, ai) => `
    <div class="slider-row" id="row-${qi}-${ai}">
      <div class="slider-answer">${ans}</div>
      <div class="slider-track-wrap">
        <input type="range" class="slider" id="sl-${qi}-${ai}"
               min="1" max="99" value="${Math.round(100 / n)}" step="1">
        <div class="slider-fill" id="fill-${qi}-${ai}"
             style="width:${Math.round(100 / n)}%"></div>
      </div>
      <div class="slider-pct" id="pct-${qi}-${ai}">${Math.round(100 / n)}%</div>
    </div>
  `).join('');
}

function wireSliders(qi, n) {
  for (let ai = 0; ai < n; ai++) {
    document.getElementById(`sl-${qi}-${ai}`)
            .addEventListener('input', () => onSliderMove(qi, ai, n));
  }
}

function onSliderMove(qi, movedAi, n) {
  // Clamp to [MIN, 1 − (n−1)×MIN] so all others can hold at least MIN
  const raw  = document.getElementById(`sl-${qi}-${movedAi}`).value / 100;
  const newVal = Math.min(Math.max(raw, SLIDER_MIN), sliderMax(n));
  const oldVals = probs[qi].slice();
  const sumOthers = oldVals.reduce((s, v, i) => i === movedAi ? s : s + v, 0);
  const remaining = 1 - newVal;

  probs[qi][movedAi] = newVal;

  for (let ai = 0; ai < n; ai++) {
    if (ai === movedAi) continue;
    // Proportional redistribution; if others were all 0, split equally
    probs[qi][ai] = sumOthers > 0
      ? (oldVals[ai] / sumOthers) * remaining
      : remaining / (n - 1);
    // Ensure no slider falls below MIN
    probs[qi][ai] = Math.max(probs[qi][ai], SLIDER_MIN);
  }

  // Re-normalise to fix floating-point drift
  const total = probs[qi].reduce((a, b) => a + b, 0);
  probs[qi] = probs[qi].map(v => v / total);

  refreshSliderUI(qi, n);
}

function refreshSliderUI(qi, n) {
  for (let ai = 0; ai < n; ai++) {
    const p = probs[qi][ai];
    document.getElementById(`sl-${qi}-${ai}`).value          = Math.round(p * 100);
    document.getElementById(`fill-${qi}-${ai}`).style.width  = pct(p);
    document.getElementById(`pct-${qi}-${ai}`).textContent   = pct(p);
  }
}

/* ── CONFIRM ─────────────────────────────────────────────────────────────────── */
function confirmAnswer(qi) {
  const q       = questions[qi];
  const n       = q.answers.length;
  const correct = q.correct;
  const p_c     = probs[qi][correct];
  const pts     = scoringRule(p_c, n);

  // Lock sliders
  if (isTrueFalse(q)) {
    document.getElementById(`tf-${qi}`).disabled = true;
  } else {
    for (let ai = 0; ai < n; ai++)
      document.getElementById(`sl-${qi}-${ai}`).disabled = true;
  }
  document.querySelector(`#card-${qi} .btn-confirm`).disabled = true;
  document.querySelector(`#card-${qi} .slider-hint`).style.display = 'none';


  // Highlight correct answer
  if (isTrueFalse(q)) {
    const side = correct === 0 ? 'true' : 'false';
    document.querySelector(`#card-${qi} .tf-label.${side}-label`)
            .classList.add('highlight-correct');
  } else {
    document.getElementById(`row-${qi}-${correct}`).classList.add('row-correct');
  }

  // Show feedback
  const fb = document.getElementById(`fb-${qi}`);
  const sign = pts >= 0 ? '+' : '';
  const ptsCls = pts >= 0 ? 'pts-pos' : 'pts-neg';
  fb.className = 'feedback show';
  fb.innerHTML = `
    <div class="fb-explanation">
      <strong>Réponse correcte:</strong> ${q.answers[correct]}<br>
      ${q.explanation}
    </div>
    <div class="fb-score">
      Tu as donné <strong>${pct(p_c)}</strong> à la bonne réponse.
      <span class="pts ${ptsCls}">${sign}${pts.toFixed(1)} pts</span>
    </div>`;

  totalScore += pts;
  answered++;
  updateProgress();
  updateScoreBar();
  typesetIfReady(`#fb-${qi}`);

    if (answered === questions.length) setTimeout(showResult, 700);
}


/* ── PROGRESS & SCORE BAR ────────────────────────────────────────────────────── */
function updateProgress() {
  const pct_ = questions.length > 0 ? answered / questions.length : 0;
  document.getElementById('progressBar').style.width = (pct_ * 100) + '%';
  document.getElementById('progressLabel').textContent =
    `${answered} / ${questions.length} confirmées`;
}

function updateScoreBar() {
  const maxPossible = questions.length * 100;
  const display = answered === 0
    ? '— pts'
    : `${totalScore.toFixed(1)} / ${(answered * 100).toFixed(0)} pts`;
  document.getElementById('liveScore').textContent = display;
}

/* ── RESULT ──────────────────────────────────────────────────────────────────── */

function showResult() {
  const panel   = document.getElementById('resultPanel');
  const maxPts  = questions.length * 100;
  const pct_    = Math.max(0, totalScore / maxPts); // can be negative

  panel.classList.add('show');
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Animate ring
  const circumference = 2 * Math.PI * 46;
  const ring = document.getElementById('ringFill');
  ring.style.strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, pct_)));
  ring.style.stroke =
    pct_ >= 0.8 ? 'var(--correct)' :
    pct_ >= 0.5 ? 'var(--accent2)' :
    pct_ >= 0    ? 'var(--accent)' : 'var(--wrong)';

  document.getElementById('scoreNum').textContent =
    `${totalScore.toFixed(0)}`;
  document.getElementById('scoreMax').textContent =
    `/ ${maxPts}`;

  const idx   = Math.min(Math.round(Math.max(0, pct_) * 4), 4);
  const titles = ['À revoir!', 'À perfectionner!', 'Très bien!', 'Excellent!', 'Parfait!'];
  // const subs   = [
  //   'Your confidence estimates need work — review the explanations above.',
  //   'Some good estimates. Aim to match your confidence to your actual knowledge.',
  //   'Solid calibration overall. The log score rewards honest uncertainty.',
  //   'Very well calibrated! Your stated beliefs closely matched your knowledge.',
  //   'Outstanding — your confidence was perfectly aligned with your knowledge!'
  // ];
  document.getElementById('resultTitle').textContent = titles[idx];
  //document.getElementById('resultSub').textContent   = subs[idx];
}

/* ── RESTART ─────────────────────────────────────────────────────────────────── */

function retryTopic() {
  document.getElementById('resultPanel').classList.remove('show');
  renderQuestions();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ── VIEW SWITCHER ────────────────────────────────────────────────────────────── */
function setView(name) {
  document.getElementById('home').style.display  = name === 'home'  ? '' : 'none';
  document.getElementById('quiz').style.display  = name === 'quiz'  ? '' : 'none';
}




/* ── UTILITY ─────────────────────────────────────────────────────────────────── */
function pct(p) { return Math.round(p * 100) + '%'; }

function typesetIfReady(selector) {
  if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
    const el = selector ? [document.querySelector(selector)] : [];
    MathJax.typesetPromise(el.filter(Boolean));
  }
}
