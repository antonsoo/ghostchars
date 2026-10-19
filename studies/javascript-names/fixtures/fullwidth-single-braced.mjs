// Authored control: Unicode escapes in distinct JavaScript bindings.
const a = 10;
const \u{FF41} = 20;
console.log(JSON.stringify([a, \u{FF41}]));
