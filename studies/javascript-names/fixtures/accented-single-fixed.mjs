// Authored control: Unicode escapes in distinct JavaScript bindings.
const á = 10;
const \u0430\u0301 = 20;
console.log(JSON.stringify([á, \u0430\u0301]));
