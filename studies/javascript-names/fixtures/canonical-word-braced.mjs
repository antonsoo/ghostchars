// Authored control: Unicode escapes in distinct JavaScript bindings.
const café = 10;
const \u{63}\u{61}\u{66}\u{65}\u{301} = 20;
console.log(JSON.stringify([café, \u{63}\u{61}\u{66}\u{65}\u{301}]));
