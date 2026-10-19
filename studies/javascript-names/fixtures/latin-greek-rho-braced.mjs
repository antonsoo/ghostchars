// Authored control: Unicode escapes in distinct JavaScript bindings.
const p = 10;
const \u{3C1} = 20;
console.log(JSON.stringify([p, \u{3C1}]));
