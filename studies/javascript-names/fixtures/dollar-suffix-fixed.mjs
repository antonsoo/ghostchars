// Authored control: Unicode escapes in distinct JavaScript bindings.
const a$ = 10;
const \u0430\u0024 = 20;
console.log(JSON.stringify([a$, \u0430\u0024]));
