// Authored control: Unicode escapes in distinct JavaScript bindings.
const e = 10;
const \u{212E} = 20;
console.log(JSON.stringify([e, \u{212E}]));
