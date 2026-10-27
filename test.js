(function () {
const PL = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./app.js') : window.ParseLab;
const results = [];
const test = (name, fn) => { try { fn(); results.push([name, true]); } catch (e) { results.push([name, false, e.message]); } };
const eq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m || ''} expected ${y} got ${x}`); };
const G = t => { const r = PL.parseGrammar(t); if (!r.ok) throw new Error('grammar invalid: ' + r.errors[0].msg); return r.grammar; };
const sorted = s => [...s].sort();
const ARITH = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
const run = (text, input, transformKind) => {
  const s = PL.createState(); const r = PL.loadGrammar(s, text); if (!r.ok) throw new Error('invalid');
  if (transformKind) { PL.transform(s, transformKind); PL.setActive(s, s.transformed); }
  return { s, p: PL.runParse(s, input) };
};
const status = (t, i, k) => run(t, i, k).p.status;
const rule = (g, A) => g.rules[A].map(r => r.join(' ') || 'ε').join(' | ');

test('parse: arrows, alternatives, epsilon, multi-char terminals', () => {
  const g = G("E -> id E' | num\nE' → ε | epsilon | + E");
  eq(g.nts, ['E', "E'"]); eq(g.rules["E'"], [[], ['+', 'E']]); eq(g.rules.E[0], ['id', "E'"]); eq(g.start, 'E');
});
test('validation: missing arrow, empty alt, bad LHS, undefined nonterminal, empty grammar, bad start', () => {
  ['S a b', 'S -> a |', '+ -> a', "S -> a T'", '', '  \n '].forEach(t => eq(PL.parseGrammar(t).ok, false, JSON.stringify(t)));
  eq(PL.parseGrammar('S -> a', 'X').ok, false);
  eq(PL.parseGrammar('S -> a ε').ok, false);
  eq(PL.parseGrammar('S -> a b\nbad line').errors[0].line, 2);
});
test('left recursion is valid syntax', () => eq(PL.parseGrammar(ARITH).ok, true));
test('tokenizer keeps E\' and id whole', () => eq(PL.tokenize("E' + id ( x )"), ["E'", '+', 'id', '(', 'x', ')']));
test('immediate left recursion: arithmetic', () => {
  const g = G(ARITH), st = []; PL.eliminateImmediate(g, st);
  eq(g.nts, ['E', "E'", 'T', "T'", 'F']); eq(rule(g, 'E'), "T E'"); eq(rule(g, "E'"), "+ T E' | ε"); eq(rule(g, "T'"), "* F T' | ε");
});
test('immediate LR: original not mutated by transform()', () => {
  const s = PL.createState(); PL.loadGrammar(s, ARITH); const before = JSON.stringify(s.active); PL.transform(s, 'all'); eq(JSON.stringify(s.active), before);
});
test('immediate LR: only-recursive alternatives reported, not mangled', () => {
  const g = G('A -> A a'), st = []; eq(PL.elimImmediate(g, 'A', st), false); eq(st[0].kind, 'error'); eq(rule(g, 'A'), 'A a');
});
test('helper-name collision uses A\'\'', () => {
  const g = G("A -> A a | b\nA' -> c"), st = []; PL.eliminateImmediate(g, st);
  eq(g.nts.includes("A''"), true); eq(rule(g, "A'"), 'c'); eq(rule(g, 'A'), "b A''");
});
test('indirect left recursion (S -> A a | b ; A -> S c | d)', () => {
  const g = G('S -> A a | b\nA -> S c | d'), st = []; eq(PL.eliminateAllLeft(g, st), true);
  eq(rule(g, 'S'), 'A a | b'); eq(rule(g, 'A'), "b c A' | d A'"); eq(rule(g, "A'"), "a c A' | ε");
  g.nts.forEach(A => g.rules[A].forEach(r => { if (r[0] === A) throw new Error('left recursion remains in ' + A); }));
});
test('left factoring: S -> a b | a c', () => {
  const g = G('S -> a b | a c'); PL.leftFactor(g, []); eq(rule(g, 'S'), "a S'"); eq(rule(g, "S'"), 'b | c');
});
test('left factoring: nested A -> a b c | a b d | a e', () => {
  const g = G('A -> a b c | a b d | a e'); PL.leftFactor(g, []);
  eq(rule(g, 'A'), "a A'"); eq(rule(g, "A'"), "b A'' | e"); eq(rule(g, "A''"), 'c | d');
});
test('left factoring keeps epsilon alternative', () => {
  const g = G('S -> a | a b'); PL.leftFactor(g, []); eq(rule(g, 'S'), "a S'"); eq(rule(g, "S'"), 'ε | b');
});
test('FIRST/FOLLOW of transformed arithmetic grammar', () => {
  const { s } = run(ARITH, 'id', 'all'); const F = s.first, W = s.follow;
  eq(sorted(F.E), ['(', 'id']); eq(sorted(F["E'"]), ['+', 'ε']); eq(sorted(F.T), ['(', 'id']); eq(sorted(F["T'"]), ['*', 'ε']); eq(sorted(F.F), ['(', 'id']);
  eq(sorted(W.E), ['$', ')']); eq(sorted(W["E'"]), ['$', ')']); eq(sorted(W.T), ['$', ')', '+']); eq(sorted(W["T'"]), ['$', ')', '+']); eq(sorted(W.F), ['$', ')', '*', '+']);
  eq(s.table.conflicts.length, 0); eq(s.table.isLL1, true);
});
test('FIRST/FOLLOW work with primed nonterminals in an already transformed grammar', () => {
  const g = G("E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id");
  const F = PL.computeFirst(g), W = PL.computeFollow(g, F);
  eq(sorted(F.E), ['(', 'id']); eq(sorted(F["E'"]), ['+', 'ε']);
  eq(sorted(F.T), ['(', 'id']); eq(sorted(F["T'"]), ['*', 'ε']);
  eq(sorted(F.F), ['(', 'id']);
  eq(sorted(W.E), ['$', ')']); eq(sorted(W["E'"]), ['$', ')']);
  eq(sorted(W.T), ['$', ')', '+']); eq(sorted(W["T'"]), ['$', ')', '+']);
  eq(sorted(W.F), ['$', ')', '*', '+']);
});
test('FIRST with multiple nullable symbols', () => {
  const g = G('S -> A B c\nA -> a | ε\nB -> b | ε'); const F = PL.computeFirst(g), W = PL.computeFollow(g, F);
  eq(sorted(F.S), ['a', 'b', 'c']); eq(sorted(W.A), ['b', 'c']); eq(sorted(W.B), ['c']);
  eq(PL.computeFirst(G('S -> A B\nA -> ε\nB -> ε')).S.has('ε'), true);
});
test('FIRST/FOLLOW fixed point on mutual recursion', () => {
  const g = G('S -> A x\nA -> B y | a\nB -> A z | b'), F = PL.computeFirst(g); eq(sorted(F.A), ['a', 'b']); eq(sorted(F.B), ['a', 'b']);
});
test('FOLLOW never contains epsilon', () => {
  const s = run('S -> a A\nA -> b | ε', 'a').s; s.active.nts.forEach(n => eq(s.follow[n].has('ε'), false));
});
test('conflict detection keeps both productions (sample 5)', () => {
  const { s, p } = run('S -> a A | a B\nA -> b\nB -> c', 'a b');
  eq(s.table.conflicts.length, 1); eq([s.table.conflicts[0].nt, s.table.conflicts[0].terminal], ['S', 'a']); eq(s.table.M.S.a.length, 2); eq(p.status, 'LL(1) CONFLICT');
});
test('sample 1: simple grammar', () => { ['a b', 'a c', 'ab', 'ac'].forEach(i => eq(status('S -> a A\nA -> b | c', i), 'ACCEPTED', i)); eq(status('S -> a A\nA -> b | c', 'a a'), 'CANNOT PROCEED'); });
test('sample 2: epsilon grammar', () => {
  const t = 'S -> a A\nA -> b | ε'; eq(status(t, 'a b'), 'ACCEPTED'); eq(status(t, 'a'), 'ACCEPTED'); eq(status(t, 'b'), 'CANNOT PROCEED');
  eq(run(t, 'a').s.table.conflicts.length, 0);
});
test('sample 3: arithmetic accepted/rejected', () => {
  ['id', 'id + id', 'id * id + id', 'id + id * id', '( id + id ) * id', 'id+id*id'].forEach(i => eq(status(ARITH, i, 'all'), 'ACCEPTED', i));
  ['id + + id', '* id', 'id id', '( id', 'id )'].forEach(i => { const st = status(ARITH, i, 'all'); if (st === 'ACCEPTED') throw new Error(i + ' wrongly accepted'); });
});
test('untransformed left-recursive grammar yields conflict, not wrong rejection', () => eq(status(ARITH, 'id + id'), 'LL(1) CONFLICT'));
test('sample 4: left factoring then parse', () => { eq(status('S -> a b | a c', 'a c', 'factor'), 'ACCEPTED'); eq(status('S -> a b | a c', 'a a', 'factor'), 'CANNOT PROCEED'); });
test('sample 6: nested parentheses', () => {
  const t = 'S -> ( S ) S | ε'; ['( )', '( ( ) )', '( ) ( )', '()()', ''].forEach(i => eq(status(t, i), 'ACCEPTED', JSON.stringify(i)));
  eq(status(t, '( ( )'), 'REJECTED');
});
test('sample 7: indirect LR then parse', () => { const t = 'S -> A a | b\nA -> S c | d'; const x = run(t, 'd a', 'all'), c = x.s.table.conflicts.map(k => k.nt + ',' + k.terminal).sort();
  eq(c, ["A',a", 'S,b']); /* genuinely not LL(1): S -> A a | b share b; A' has a c A' vs epsilon on a */
  eq(x.p.status, 'LL(1) CONFLICT'); eq(x.s.table.M.S.d.length, 1); });
test('invalid input token and extra input', () => {
  eq(status('S -> a A\nA -> b | c', 'a z'), 'INVALID INPUT'); eq(status('S -> a A\nA -> b | c', 'a b b'), 'REJECTED');
  eq(run('S -> a A\nA -> b | c', 'a b b').p.message.includes('input remains'), true);
});
test('trace accuracy: initial row, stack top at left, epsilon pops only', () => {
  const { p } = run('S -> a A\nA -> b | ε', 'a'); const t = p.steps;
  eq([t[0].stack, t[0].input], ['S $', 'a $']); eq(t[1].stack, 'a A $'); eq(t[2].stack, 'A $'); eq(t[2].action.includes('epsilon'), true); eq(t[3].stack, '$'); eq(t[t.length - 1].action, 'Accept'); eq(t.length, 4);
});
test('empty table cell message', () => {
  const { p } = run('S -> a A\nA -> b | c', 'a a'); eq(p.status, 'CANNOT PROCEED'); eq(p.message, 'No production exists for nonterminal A with lookahead token a.');
});
test('terminal mismatch message', () => { const { p } = run('S -> ( a )', '( a a'); eq(p.status, 'REJECTED'); eq(p.message, "The parser expected ')' but found 'a'."); });
test('stale-state prevention: new active grammar clears analysis and parse', () => {
  const s = PL.createState(); PL.loadGrammar(s, ARITH); PL.computeAnalysis(s); PL.runParse(s, 'id'); const rev = s.revision;
  PL.transform(s, 'all'); PL.setActive(s, s.transformed);
  eq(s.revision, rev + 1); eq([s.first, s.follow, s.table, s.parse], [null, null, null, null]); eq(s.transformed, null);
  PL.runParse(s, 'id + id'); eq(s.analysisRev, s.revision); eq(s.parse.status, 'ACCEPTED');
});
test('restore original', () => { const s = PL.createState(); PL.loadGrammar(s, ARITH); PL.transform(s, 'all'); PL.setActive(s, s.transformed); PL.setActive(s, s.original); eq(s.active.nts, ['E', 'T', 'F']); });
test('maximum-step limit prevents infinite loop', () => {
  const g = G('S -> S'), F = PL.computeFirst(g), W = PL.computeFollow(g, F); const tbl = PL.buildTable(g, F, W);
  tbl.M.S.$ = [{ lhs: 'S', rhs: ['S'] }]; // force a self-expanding unique cell
  const r = PL.predictiveParse(g, tbl, []); eq(r.status, 'CANNOT PROCEED'); eq(r.steps.length, PL.MAX_STEPS + 1);
});
test('no grammar -> INVALID GRAMMAR', () => eq(PL.runParse(PL.createState(), 'a').status, 'INVALID GRAMMAR'));

const failed = results.filter(r => !r[1]);
if (typeof document !== 'undefined') {
  document.getElementById('out').innerHTML = `<h2>${results.length - failed.length}/${results.length} passed</h2>` + results.map(r => `<div class="${r[1] ? 'p' : 'f'}">${r[1] ? '✔' : '✘'} ${r[0]}${r[2] ? ' — ' + r[2] : ''}</div>`).join('');
} else {
  results.forEach(r => console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[2] ? ' -- ' + r[2] : '')));
  console.log(`\n${results.length - failed.length}/${results.length} passed`); process.exit(failed.length ? 1 : 0);
}
})();
