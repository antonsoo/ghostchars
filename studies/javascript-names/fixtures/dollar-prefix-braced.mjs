// Authored control: Unicode escapes in distinct JavaScript bindings.
const $a = 10;
const \u{24}\u{430} = 20;
console.log(JSON.stringify([$a, \u{24}\u{430}]));
