// Authored control: Unicode escapes in distinct JavaScript bindings.
const é = 10;
const \u{65}\u{301} = 20;
console.log(JSON.stringify([é, \u{65}\u{301}]));
