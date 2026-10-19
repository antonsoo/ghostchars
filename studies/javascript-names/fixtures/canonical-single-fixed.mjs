// Authored control: Unicode escapes in distinct JavaScript bindings.
const é = 10;
const \u0065\u0301 = 20;
console.log(JSON.stringify([é, \u0065\u0301]));
