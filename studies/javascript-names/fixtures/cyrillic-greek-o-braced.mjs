// Authored control: Unicode escapes in distinct JavaScript bindings.
const о = 10;
const \u{3BF} = 20;
console.log(JSON.stringify([о, \u{3BF}]));
