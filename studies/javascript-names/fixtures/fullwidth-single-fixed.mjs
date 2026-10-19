// Authored control: Unicode escapes in distinct JavaScript bindings.
const a = 10;
const \uFF41 = 20;
console.log(JSON.stringify([a, \uFF41]));
