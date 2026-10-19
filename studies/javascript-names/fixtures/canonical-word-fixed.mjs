// Authored control: Unicode escapes in distinct JavaScript bindings.
const café = 10;
const \u0063\u0061\u0066\u0065\u0301 = 20;
console.log(JSON.stringify([café, \u0063\u0061\u0066\u0065\u0301]));
