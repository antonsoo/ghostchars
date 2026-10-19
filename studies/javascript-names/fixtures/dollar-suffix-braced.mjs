// Authored control: Unicode escapes in distinct JavaScript bindings.
const a$ = 10;
const \u{430}\u{24} = 20;
console.log(JSON.stringify([a$, \u{430}\u{24}]));
