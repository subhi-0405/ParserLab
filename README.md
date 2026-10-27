# ParseLab — Grammar Transformation and Predictive Parsing Toolkit
Browser-only educational tool (HTML, CSS, vanilla JS; no backend, no dependencies).

## Features
Grammar editor with line-specific validation; immediate and indirect left-recursion elimination; left factoring with step log; FIRST/FOLLOW (fixed point); LL(1) table with conflict detection; table-driven predictive parser with step trace; revision-tracked shared state (activating a transformed grammar invalidates FIRST/FOLLOW, table and parse results); dashboard; help; 7 samples.

## Files
`index.html`, `styles.css`, `app.js` (engine + UI), `tests/test.html` + `tests/test.js`, `assets/favicon.svg`.

## Run
Open `index.html` in a browser (or VS Code Live Server). Run the tests with `node test.js`.

## Notation
`A -> x | y`, `→` also accepted. `ε` or `epsilon` = empty. Identifiers such as `id`, `num`, `E'` are single symbols; every other character is its own symbol. **Use spaces** between symbols (`a b`, not `ab`). Nonterminals are the symbols on a left-hand side. Parser input is whitespace-separated tokens; a word that is not a terminal is split into terminals by longest match (`ab` → `a b`).
Parser stack is shown with the **top on the left**.

## Limitations
Indirect elimination assumes no ε-cycles (`A =>+ A`). A grammar whose left-recursive nonterminal has no non-recursive alternative is reported, not transformed. Undefined-nonterminal detection applies to primed names (e.g. `T'`), since other unknown names are treated as terminals. Step limit is 2000. Tests were run under Node; the same file runs in the browser, but the UI itself was not exercised in a real browser here.
