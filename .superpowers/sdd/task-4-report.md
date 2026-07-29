# Task 4: Regression Audit For Small Text-Entry Controls

- Added the required React source audit for `text-xs` and `text-sm` on shared text-entry controls.
- Hardened inline `font-size` auditing for native and shared React controls. Only numeric `px`/`rem` values at or above `16px`/`1rem` are accepted; ambiguous units and expressions fail.
- Preserved existing label and helper typography by hoisting their class strings above the source-level control scan boundary.
- RED: the new ambiguous-value tests failed against the previous numeric-only parser; the required class audit also identified source-order matches.
- GREEN: focused tests passed, 37/37; full `npm test` passed, 406/406 across 49 files.
- Follow-up RED: the new HTML `font-size: 16` regression failed because the bare-number fallback also accepted CSS declarations.
- Follow-up GREEN: unitless values are accepted only for JSX numeric `fontSize` styles at or above 16; HTML `font-size: 16` and `12`, plus JSX `fontSize: 12`, are rejected.
