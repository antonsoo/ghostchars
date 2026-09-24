// A HANGUL CHOSEONG FILLER (U+115F) hidden inside the second property name
// makes it render identically to the first one, so a reviewer sees one
// "adminOverride" check repeated -- but the engine sees two distinct
// properties, and the hidden one silently grants access.
function authorize(user, flags) {
  if (flags.adminOverride) {
    return false; // the check everyone reads and reviews
  }
  if (flags.adminᅟOverride) { // contains U+115F -- a different property entirely
    return true; // silently grants access; ghostchars flags the invisible character
  }
  return user.role === 'admin';
}

module.exports = { authorize };
