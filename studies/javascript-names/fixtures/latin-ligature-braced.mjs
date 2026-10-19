// Authored control: Unicode escapes in distinct JavaScript bindings.
const ff = 10;
const \u{FB00} = 20;
console.log(JSON.stringify([ff, \u{FB00}]));
