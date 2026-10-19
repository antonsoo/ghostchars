// Authored control: Unicode escapes in distinct JavaScript bindings.
const o = 10;
const \u{3BF} = 20;
console.log(JSON.stringify([o, \u{3BF}]));
