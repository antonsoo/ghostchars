// Authored control: Unicode escapes in distinct JavaScript bindings.
const ו = 10;
const \u{5DF} = 20;
console.log(JSON.stringify([ו, \u{5DF}]));
