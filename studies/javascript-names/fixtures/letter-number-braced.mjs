// Authored control: Unicode escapes in distinct JavaScript bindings.
const I = 10;
const \u{2160} = 20;
console.log(JSON.stringify([I, \u{2160}]));
