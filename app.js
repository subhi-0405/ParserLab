/* ParseLab - grammar engine (pure functions) + UI (only runs in a browser). No dependencies. */
(function (root) {
'use strict';
const EPS = 'ε', END = '$', MAX_STEPS = 2000;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = o => JSON.parse(JSON.stringify(o));
const sameSeq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const dedupe = list => list.filter((r, i) => list.findIndex(q => sameSeq(q, r)) === i);
const showRhs = r => r.length ? r.join(' ') : EPS;
const prodText = (A, r) => `${A} -> ${showRhs(r)}`;
const ID = /^[A-Za-z_][A-Za-z0-9_]*'*$/;

/* ---------- 1. Grammar parsing & validation ---------- */
// Tokens: identifiers (optionally ending in primes, e.g. E', id, num) are ONE symbol; any other
// non-space character is its own symbol. Use spaces between symbols ("a b", not "ab").
const tokenize = s => (s.match(/[A-Za-z_][A-Za-z0-9_]*'*|ε|\S/g) || []).map(t => t === 'epsilon' ? EPS : t);

function parseGrammar(text, startOverride) {
  const errors = [], rules = {}, nts = [];
  const err = (line, msg) => errors.push({ line, msg });
  const raw = [];
  String(text || '').split(/\r?\n/).forEach((ln, i) => {
    if (!ln.trim()) return;
    const parts = ln.split(/->|→/);
    if (parts.length < 2) return err(i + 1, 'Missing production arrow (-> or →).');
    if (parts.length > 2) return err(i + 1, 'More than one arrow on this line.');
    const lhs = parts[0].trim();
    if (!lhs) return err(i + 1, 'Empty left-hand side.');
    if (!ID.test(lhs)) return err(i + 1, `Invalid left-hand side "${lhs}". Use a single nonterminal name such as E or T'.`);
    if (!nts.includes(lhs)) { nts.push(lhs); rules[lhs] = []; }
    parts[1].split('|').forEach(alt => {
      const t = tokenize(alt);
      if (!t.length) return err(i + 1, `Empty alternative for ${lhs}. Write ε for an empty production.`);
      if (t.includes(EPS) && t.length > 1) return err(i + 1, 'ε must be the only symbol in an alternative.');
      if (t.some(s => s === "'")) return err(i + 1, "A stray ' was found. Primes must directly follow a name, like E'.");
      raw.push({ line: i + 1, lhs, rhs: t[0] === EPS ? [] : t });
    });
  });
  if (!nts.length && !errors.length) err(0, 'The grammar is empty. Enter at least one production.');
  raw.forEach(p => {
    p.rhs.forEach(s => { if (s.endsWith("'") && !nts.includes(s)) err(p.line, `The nonterminal ${s} is referenced but has no production.`); });
    if (!rules[p.lhs].some(r => sameSeq(r, p.rhs))) rules[p.lhs].push(p.rhs); // duplicate alternatives are merged
  });
  const start = startOverride || nts[0];
  if (nts.length && !nts.includes(start)) err(0, `Invalid start symbol "${start}": it must be a nonterminal.`);
  return errors.length ? { ok: false, errors } : { ok: true, errors, grammar: { start, nts, rules } };
}
const terminalsOf = g => { const T = []; g.nts.forEach(n => g.rules[n].forEach(r => r.forEach(s => { if (!g.nts.includes(s) && !T.includes(s)) T.push(s); }))); return T; };
const prodsOf = g => g.nts.flatMap(A => g.rules[A].map((rhs, i) => ({ id: A + '#' + i, lhs: A, rhs })));
const grammarText = g => g.nts.map(A => `${A} -> ${g.rules[A].map(showRhs).join(' | ')}`).join('\n');
const ruleLine = (g, A) => `${A} -> ${g.rules[A].map(showRhs).join(' | ')}`;

/* ---------- 2. Transformations ---------- */
function freshName(g, A) { const T = terminalsOf(g); let n = A + "'"; while (g.nts.includes(n) || T.includes(n)) n += "'"; return n; }

function elimImmediate(g, A, steps) {
  const alts = g.rules[A], rec = alts.filter(r => r[0] === A), non = alts.filter(r => r[0] !== A);
  if (!rec.length) return true;
  if (!non.length) { steps.push({ nt: A, kind: 'error', text: `${A} has only left-recursive alternatives (${rec.map(r => prodText(A, r)).join('; ')}), so it derives no finite string. It cannot be transformed.`, result: [] }); return false; }
  const N = freshName(g, A);
  g.rules[A] = non.map(b => [...b, N]);
  g.rules[N] = [...rec.map(r => [...r.slice(1), N]), []];
  g.nts.splice(g.nts.indexOf(A) + 1, 0, N);
  steps.push({ nt: A, kind: 'immediate left recursion', helper: N,
    text: `Pattern A → Aα | β detected for ${A}. Left-recursive alternatives: ${rec.map(r => showRhs(r)).join(' | ')}. Non-recursive alternatives: ${non.map(showRhs).join(' | ')}. Created helper ${N}.`,
    result: [ruleLine(g, A), ruleLine(g, N)] });
  return true;
}
function eliminateImmediate(g, steps) { let ok = true; [...g.nts].forEach(A => { if (!elimImmediate(g, A, steps)) ok = false; }); return ok; }

// Ordered-substitution algorithm (Aho/Sethi/Ullman). Limitation: assumes no ε-cycles (A =>+ A).
function eliminateAllLeft(g, steps) {
  const order = [...g.nts]; let ok = true;
  for (let i = 0; i < order.length; i++) {
    const Ai = order[i];
    for (let j = 0; j < i; j++) {
      const Aj = order[j], out = []; let changed = false;
      g.rules[Ai].forEach(r => { if (r[0] === Aj) { changed = true; g.rules[Aj].forEach(d => out.push([...d, ...r.slice(1)])); } else out.push(r); });
      if (changed) { g.rules[Ai] = dedupe(out); steps.push({ nt: Ai, kind: 'substitution', text: `Indirect recursion check: replaced leading ${Aj} in the productions of ${Ai} by each alternative of ${Aj}.`, result: [ruleLine(g, Ai)] }); }
    }
    if (!elimImmediate(g, Ai, steps)) ok = false;
  }
  return ok;
}

function leftFactor(g, steps) {
  for (let guard = 0, again = true; again && guard < 500; guard++) {
    again = false;
    for (const A of [...g.nts]) {
      const alts = g.rules[A], groups = new Map();
      alts.forEach(r => { if (r.length) { if (!groups.has(r[0])) groups.set(r[0], []); groups.get(r[0]).push(r); } });
      const grp = [...groups.values()].find(x => x.length > 1);
      if (!grp) continue;
      let p = 0; while (grp.every(r => r.length > p && r[p] === grp[0][p])) p++;
      const prefix = grp[0].slice(0, p), N = freshName(g, A), out = []; let placed = false;
      alts.forEach(r => { if (!grp.includes(r)) out.push(r); else if (!placed) { out.push([...prefix, N]); placed = true; } });
      g.rules[A] = out; g.rules[N] = dedupe(grp.map(r => r.slice(p)));
      g.nts.splice(g.nts.indexOf(A) + 1, 0, N);
      steps.push({ nt: A, kind: 'left factoring', helper: N, text: `${grp.length} alternatives of ${A} share the common prefix "${prefix.join(' ')}". Introduced ${N} for the differing suffixes.`, result: [ruleLine(g, A), ruleLine(g, N)] });
      again = true; break;
    }
  }
}

/* ---------- 3. FIRST / FOLLOW / table ---------- */
function firstSeq(seq, F) {
  const out = new Set(); let allNull = true;
  for (const X of seq) {
    if (has(F, X)) { F[X].forEach(x => { if (x !== EPS) out.add(x); }); if (!F[X].has(EPS)) { allNull = false; break; } }
    else { out.add(X); allNull = false; break; }
  }
  if (allNull) out.add(EPS);
  return out;
}
function computeFirst(g) {
  const F = {}; g.nts.forEach(n => F[n] = new Set());
  for (let ch = true; ch;) { ch = false; g.nts.forEach(n => g.rules[n].forEach(r => firstSeq(r, F).forEach(x => { if (!F[n].has(x)) { F[n].add(x); ch = true; } }))); }
  return F;
}
function computeFollow(g, F) {
  const W = {}; g.nts.forEach(n => W[n] = new Set()); W[g.start].add(END);
  for (let ch = true; ch;) {
    ch = false;
    g.nts.forEach(A => g.rules[A].forEach(r => r.forEach((B, i) => {
      if (!has(W, B)) return;
      const f = firstSeq(r.slice(i + 1), F), add = [...f].filter(x => x !== EPS);
      if (f.has(EPS)) W[A].forEach(x => add.push(x));
      add.forEach(x => { if (!W[B].has(x)) { W[B].add(x); ch = true; } });
    })));
  }
  return W;
}
function buildTable(g, F, W) {
  const M = {}, conflicts = []; g.nts.forEach(n => M[n] = {});
  g.nts.forEach(A => g.rules[A].forEach((r, i) => {
    const f = firstSeq(r, F), la = [...f].filter(x => x !== EPS);
    if (f.has(EPS)) W[A].forEach(x => la.push(x));
    la.forEach(a => { const c = M[A][a] = M[A][a] || []; if (!c.some(p => sameSeq(p.rhs, r))) c.push({ lhs: A, rhs: r, id: A + '#' + i }); });
  }));
  g.nts.forEach(A => Object.keys(M[A]).forEach(a => { if (M[A][a].length > 1) conflicts.push({ nt: A, terminal: a, prods: M[A][a] }); }));
  return { M, conflicts, terminals: [...terminalsOf(g), END], isLL1: conflicts.length === 0 };
}

/* ---------- 4. Predictive parser ---------- */
function tokenizeInput(str, terminals) {
  const tokens = [], byLen = [...terminals].sort((a, b) => b.length - a.length);
  for (const w of String(str).trim().split(/\s+/).filter(Boolean)) {
    if (terminals.includes(w)) { tokens.push(w); continue; }
    let i = 0; const piece = [];
    while (i < w.length) { const t = byLen.find(x => w.startsWith(x, i)); if (!t) return { error: `"${w}" contains text that is not a terminal of the grammar (stopped at "${w.slice(i)}"). Terminals: ${terminals.join(', ') || '(none)'}.` }; piece.push(t); i += t.length; }
    tokens.push(...piece);
  }
  return { tokens };
}
// Stack is displayed with the TOP at the LEFT (stored internally with the top at the end of the array).
function predictiveParse(g, tbl, tokens) {
  const steps = []; let stack = [END, g.start], pos = 0, status = null, message = '', hint = '';
  const row = action => steps.push({ n: steps.length + 1, stack: stack.slice().reverse().join(' '), input: [...tokens.slice(pos), END].join(' '), look: pos < tokens.length ? tokens[pos] : END, action });
  while (!status) {
    if (steps.length >= MAX_STEPS) { row('Step limit reached'); status = 'CANNOT PROCEED'; message = `Stopped after ${MAX_STEPS} steps to avoid an infinite loop.`; break; }
    const top = stack[stack.length - 1], la = pos < tokens.length ? tokens[pos] : END, shown = la === END ? 'end of input' : `'${la}'`;
    if (top === END) {
      if (la === END) { row('Accept'); status = 'ACCEPTED'; message = 'The input string is accepted.'; }
      else { row(`Reject: input remains (${shown})`); status = 'REJECTED'; message = `The stack is empty but input remains, starting at ${shown}.`; hint = 'Remove the extra tokens.'; }
    } else if (g.nts.includes(top)) {
      const cell = tbl.M[top][la];
      if (!cell) { row(`Error: M[${top}, ${la}] is empty`); status = 'CANNOT PROCEED'; message = `No production exists for nonterminal ${top} with lookahead token ${la}.`; hint = `Expected one of: ${Object.keys(tbl.M[top]).join(' ') || '(nothing)'}.`; }
      else if (cell.length > 1) { row(`LL(1) conflict at M[${top}, ${la}]`); status = 'LL(1) CONFLICT'; message = `Multiple productions are available for nonterminal ${top} and lookahead token ${la} (${cell.map(p => prodText(p.lhs, p.rhs)).join('  vs  ')}). Predictive parsing cannot choose a unique production.`; hint = 'Left-factor or otherwise transform the grammar. This does not mean the string is outside the language.'; }
      else { const p = cell[0]; row(p.rhs.length ? `Expand ${prodText(top, p.rhs)}` : `Expand ${prodText(top, p.rhs)} (epsilon: pop only)`); stack.pop(); for (let i = p.rhs.length - 1; i >= 0; i--) stack.push(p.rhs[i]); }
    } else if (top === la) { row(`Match '${top}'`); stack.pop(); pos++; }
    else { row(`Error: expected '${top}'`); status = 'REJECTED'; message = `The parser expected '${top}' but found ${shown}.`; hint = `Insert or replace a token so that '${top}' appears here.`; }
  }
  return { status, message, hint, steps };
}

/* ---------- 5. Shared application state ---------- */
const createState = () => ({ originalText: '', original: null, transformed: null, active: null, history: [], revision: 0, analysisRev: -1, first: null, follow: null, table: null, input: '', parse: null });
function invalidate(s) { s.first = s.follow = s.table = null; s.analysisRev = -1; s.parse = null; }
function setActive(s, g) { s.active = clone(g); s.revision++; s.transformed = null; invalidate(s); }
function loadGrammar(s, text, start) {
  const r = parseGrammar(text, start);
  if (!r.ok) return r;
  s.originalText = text; s.original = clone(r.grammar); s.history = []; s.input = ''; setActive(s, r.grammar);
  return r;
}
function computeAnalysis(s) {
  if (!s.active) return false;
  s.first = computeFirst(s.active); s.follow = computeFollow(s.active, s.first);
  s.table = buildTable(s.active, s.first, s.follow); s.analysisRev = s.revision; return true;
}
function runParse(s, input) {
  s.input = input;
  if (!s.active) return (s.parse = { status: 'INVALID GRAMMAR', message: 'No valid grammar is active. Analyze a grammar first.', hint: '', steps: [] });
  if (s.analysisRev !== s.revision) computeAnalysis(s);
  const t = tokenizeInput(input, s.table.terminals.filter(x => x !== END));
  if (t.error) return (s.parse = { status: 'INVALID INPUT', message: t.error, hint: 'Use only terminals of the active grammar.', steps: [] });
  return (s.parse = predictiveParse(s.active, s.table, t.tokens));
}
function transform(s, kind) {
  if (!s.active) return null;
  const g = s.transformed || clone(s.active), steps = [];
  let ok = true;
  if (kind === 'immediate') ok = eliminateImmediate(g, steps);
  if (kind === 'left' || kind === 'all') ok = eliminateAllLeft(g, steps);
  if (kind === 'factor' || kind === 'all') leftFactor(g, steps);
  if (!steps.length) steps.push({ nt: '-', kind: 'no change', text: 'Nothing to transform: no matching pattern was found.', result: [] });
  s.transformed = g; s.history.push(...steps);
  return { ok, steps };
}
const SAMPLES = {
  'Simple Grammar': ['S -> a A\nA -> b | c', 'a b'],
  'Simple Epsilon Grammar': ['S -> a A\nA -> b | ε', 'a'],
  'Arithmetic Expressions': ['E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id', 'id + id * id'],
  'Left Factoring': ['S -> a b | a c', 'a b'],
  'LL(1) Conflict': ['S -> a A | a B\nA -> b\nB -> c', 'a b'],
  'Nested Parentheses': ['S -> ( S ) S | ε', '( ) ( )'],
  'Indirect Left Recursion': ['S -> A a | b\nA -> S c | d', 'b a']
};
const API = { EPS, END, MAX_STEPS, parseGrammar, tokenize, terminalsOf, prodsOf, grammarText, elimImmediate, eliminateImmediate, eliminateAllLeft, leftFactor, computeFirst, computeFollow, buildTable, tokenizeInput, predictiveParse, createState, setActive, loadGrammar, computeAnalysis, runParse, transform, SAMPLES, clone };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ParseLab = API;

/* ---------- 6. UI ---------- */
if (typeof document === 'undefined') return;
const S = createState(), $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PAGES = { dashboard: ['Dashboard', 'What ParseLab does and the state of the active grammar.'], editor: ['Grammar Editor', 'Enter a context-free grammar and validate it.'], transform: ['Transformations', 'Remove left recursion and left-factor the grammar.'], ff: ['FIRST & FOLLOW', 'Fixed-point computation of FIRST and FOLLOW sets.'], table: ['Parsing Table', 'LL(1) table with conflict detection.'], parser: ['Predictive Parser', 'Table-driven parsing with a full step trace. Stack top is on the left.'], help: ['Help & Examples', 'Short explanations of the concepts used here.'] };
let page = 'dashboard', idx = 0, errs = [];
const setList = s => '{ ' + [...s].join(', ') + ' }';
const badge = (t, c) => `<span class="badge ${c}">${esc(t)}</span>`;
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show ' + (bad ? 'bad' : 'ok'); clearTimeout(toast.h); toast.h = setTimeout(() => t.className = '', 3500); }
function sampleButtons() { return Object.keys(SAMPLES).map(k => `<button class="btn ghost" data-sample="${esc(k)}">${esc(k)}</button>`).join(''); }
function gBox(g, title) { return `<div class="card"><h3>${title}</h3>${g ? `<pre class="code">${esc(grammarText(g))}</pre><p class="muted">Start: <b>${esc(g.start)}</b></p>` : '<p class="empty">No grammar yet.</p>'}</div>`; }
function stale() { return S.active && S.analysisRev !== S.revision; }

function renderDashboard() {
  const g = S.active, ll = S.table ? (S.table.isLL1 ? badge('LL(1)', 'ok') : badge(S.table.conflicts.length + ' conflict(s)', 'bad')) : badge('not computed', 'warn');
  const card = (k, v) => `<div class="card stat"><span class="muted">${k}</span><b>${v}</b></div>`;
  $('#dashboard').innerHTML = `<p>ParseLab transforms context-free grammars and builds LL(1) predictive parsers, entirely in your browser.</p>
  <div class="grid">${card('Active grammar', g ? badge('valid · rev ' + S.revision, 'ok') : badge('none', 'warn'))}${card('Nonterminals', g ? g.nts.length : '–')}${card('Terminals', g ? terminalsOf(g).length : '–')}${card('Productions', g ? prodsOf(g).length : '–')}
  ${card('FIRST/FOLLOW', S.first ? badge('computed', 'ok') : badge('not computed', 'warn'))}${card('LL(1) status', ll)}${card('Last parse', S.parse ? badge(S.parse.status, S.parse.status === 'ACCEPTED' ? 'ok' : 'bad') : badge('none', 'warn'))}</div>
  <div class="card"><h3>Workflow</h3><p class="flow">Grammar Input → Validation → Transformation → FIRST &amp; FOLLOW → LL(1) Table → Predictive Parsing → Accept / Error explanation</p>
  <button class="btn" data-go="editor">Quick start: open Grammar Editor</button></div><div class="card"><h3>Sample grammars</h3><div class="row">${sampleButtons()}</div></div>`;
}
function renderEditor() {
  $('#errors').innerHTML = errs.length ? '<ul>' + errs.map(e => `<li>${e.line ? 'Line ' + e.line + ': ' : ''}${esc(e.msg)}</li>`).join('') + '</ul>' : '';
  const sel = $('#startSel'); const cur = sel.value;
  sel.innerHTML = '<option value="">(first production)</option>' + (S.original ? S.original.nts.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('') : '');
  $('#examples').innerHTML = sampleButtons();
}
function renderTransform() {
  const steps = S.history.map((s, i) => `<li><b>${i + 1}. ${esc(s.kind)}</b> on <code>${esc(s.nt)}</code>${s.helper ? ` → helper <code>${esc(s.helper)}</code>` : ''}<br>${esc(s.text)}${s.result.length ? `<pre class="code">${esc(s.result.join('\n'))}</pre>` : ''}</li>`).join('');
  $('#tfOut').innerHTML = `<div class="two">${gBox(S.active, 'Original / active grammar')}${gBox(S.transformed, 'Transformed grammar (not yet active)')}</div><div class="card"><h3>Transformation steps</h3>${steps ? `<ol class="steps">${steps}</ol>` : '<p class="empty">No transformations applied yet.</p>'}</div>`;
}
function table2(head, rows) { return `<div class="scroll"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`; }
function renderFF() {
  const g = S.active; let body;
  if (!g) body = '<p class="empty">No valid grammar. Analyze a grammar in the editor first.</p>';
  else if (!S.first) body = '<p class="empty">Not computed yet for this grammar revision. Click Compute.</p>';
  else body = `<div class="two"><div class="card"><h3>FIRST sets</h3>${table2(['Nonterminal', 'FIRST'], g.nts.map(n => `<tr><td>${esc(n)}</td><td>${esc(setList(S.first[n]))}</td></tr>`).join(''))}</div><div class="card"><h3>FOLLOW sets</h3>${table2(['Nonterminal', 'FOLLOW'], g.nts.map(n => `<tr><td>${esc(n)}</td><td>${esc(setList(S.follow[n]))}</td></tr>`).join(''))}</div></div>`;
  $('#ffOut').innerHTML = (g ? `<p>Active grammar (revision ${S.revision}) ${S.first ? badge('up to date', 'ok') : badge('needs computing', 'warn')}</p><pre class="code">${esc(grammarText(g))}</pre>` : '') + body;
  $('#computeBtn').disabled = !g;
}
function renderTable() {
  const t = S.table; let h;
  if (!S.active) h = '<p class="empty">No valid grammar is active.</p>';
  else if (!t) h = '<p class="empty">Table not built for this revision. Click Build Table.</p>';
  else {
    const rows = S.active.nts.map(A => `<tr><th>${esc(A)}</th>${t.terminals.map(a => { const c = t.M[A][a]; return c ? `<td class="${c.length > 1 ? 'conf' : ''}">${c.map(p => esc(prodText(p.lhs, p.rhs))).join('<br>')}</td>` : '<td></td>'; }).join('')}</tr>`).join('');
    h = `<p>${t.isLL1 ? badge('LL(1): Yes', 'ok') : badge('LL(1): No', 'bad')} Conflicts: <b>${t.conflicts.length}</b></p>` +
      t.conflicts.map(c => `<div class="warnbox">Conflict at M[${esc(c.nt)}, ${esc(c.terminal)}]: ${c.prods.map(p => '<code>' + esc(prodText(p.lhs, p.rhs)) + '</code>').join(' and ')} both apply. The parser cannot choose one.</div>`).join('') +
      table2(['', ...t.terminals], rows);
  }
  $('#tableOut').innerHTML = h; $('#buildBtn').disabled = !S.active;
}
function renderParser() {
  const p = S.parse; $('#parseInput').value = S.input; let h = '';
  if (p) {
    idx = Math.min(Math.max(idx, 0), Math.max(p.steps.length - 1, 0));
    const ok = p.status === 'ACCEPTED';
    h = `<div class="card"><p>${badge(p.status, ok ? 'ok' : 'bad')} ${esc(p.message)}</p>${p.hint ? `<p class="muted">Suggestion: ${esc(p.hint)}</p>` : ''}</div>`;
    if (p.steps.length) h += `<div class="row"><button class="btn ghost" id="prevB">◀ Previous</button><button class="btn ghost" id="nextB">Next ▶</button><button class="btn ghost" id="allB">Show all</button><span class="muted">Step ${idx + 1} of ${p.steps.length}</span></div>` +
      table2(['Step', 'Stack (top left)', 'Remaining input', 'Lookahead', 'Action'], p.steps.slice(0, idx + 1).map((s, i) => `<tr class="${i === idx ? 'cur' : ''}"><td>${s.n}</td><td>${esc(s.stack)}</td><td>${esc(s.input)}</td><td>${esc(s.look)}</td><td>${esc(s.action)}</td></tr>`).join(''));
  } else h = '<p class="empty">No parse yet. Enter tokens separated by spaces, then click Parse.</p>';
  $('#parseOut').innerHTML = h;
}
function render() {
  Object.entries(PAGES).forEach(([k, v]) => { $('#' + k).hidden = k !== page; });
  document.querySelectorAll('#sidebar [data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === page ? 'page' : 'false'));
  $('#title').textContent = PAGES[page][0]; $('#sub').textContent = PAGES[page][1];
  ({ dashboard: renderDashboard, editor: renderEditor, transform: renderTransform, ff: renderFF, table: renderTable, parser: renderParser, help() {} })[page]();
}
function go(p) { page = p; $('#sidebar').classList.remove('open'); render(); window.scrollTo(0, 0); }
function analyze() {
  const r = loadGrammar(S, $('#grammarText').value, $('#startSel').value || undefined);
  errs = r.errors; render();
  if (r.ok) toast(`Grammar valid: ${r.grammar.nts.length} nonterminals, ${prodsOf(r.grammar).length} productions.`); else toast('Grammar has errors. Nothing was calculated.', true);
}
function loadSample(k) { $('#grammarText').value = SAMPLES[k][0]; $('#parseInput').value = SAMPLES[k][1]; analyze(); S.input = SAMPLES[k][1]; go('editor'); }
function transformBtn(kind) {
  if (!S.active) return toast('Analyze a valid grammar first.', true);
  const r = transform(S, kind); render(); toast(r.ok ? 'Transformation applied (not active yet).' : 'Some steps could not be applied. See the steps list.', !r.ok);
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.go) return go(b.dataset.go);
  if (b.dataset.sample) return loadSample(b.dataset.sample);
  const id = b.id;
  if (id === 'menuBtn') $('#sidebar').classList.toggle('open');
  else if (id === 'analyzeBtn') analyze();
  else if (id === 'clearBtn') { $('#grammarText').value = ''; errs = []; render(); }
  else if (id === 'exampleBtn') loadSample('Arithmetic Expressions');
  else if (id === 'tImm') transformBtn('immediate'); else if (id === 'tLeft') transformBtn('left');
  else if (id === 'tFac') transformBtn('factor'); else if (id === 'tAll') transformBtn('all');
  else if (id === 'tUse') {
    if (!S.transformed) return toast('No transformed grammar to use.', true);
    setActive(S, S.transformed); render(); toast('Transformed grammar is now active (revision ' + S.revision + '). FIRST/FOLLOW, table and parse results were reset.');
  } else if (id === 'tRestore') { if (!S.original) return; setActive(S, S.original); S.history = []; render(); toast('Original grammar restored.'); }
  else if (id === 'computeBtn' || id === 'buildBtn') { computeAnalysis(S); render(); toast('FIRST, FOLLOW and the LL(1) table are up to date.'); }
  else if (id === 'parseBtn') { idx = 1e9; runParse(S, $('#parseInput').value); render(); }
  else if (id === 'prevB') { idx--; renderParser(); } else if (id === 'nextB') { idx++; renderParser(); } else if (id === 'allB') { idx = 1e9; renderParser(); }
});
$('#grammarText').value = SAMPLES['Arithmetic Expressions'][0];
render();
})(typeof window !== 'undefined' ? window : globalThis);
