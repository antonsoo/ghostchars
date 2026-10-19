// Authored control: Unicode escapes in distinct JavaScript bindings.
const á = 10;
const \u{430}\u{301} = 20;
console.log(JSON.stringify([á, \u{430}\u{301}]));
