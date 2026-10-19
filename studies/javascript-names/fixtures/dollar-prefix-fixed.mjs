// Authored control: Unicode escapes in distinct JavaScript bindings.
const $a = 10;
const \u0024\u0430 = 20;
console.log(JSON.stringify([$a, \u0024\u0430]));
