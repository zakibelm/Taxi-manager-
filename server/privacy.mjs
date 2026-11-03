// Free text typed by a driver is forwarded to an external model provider (Loi 25 / data minimisation).
// Block the most obvious direct identifiers before anything leaves the server.
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const NANP_PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const LONG_DIGITS = /\b\d{10,}\b/;
function luhn(digits) {
 let sum = 0;
 for(let i = 0; i < digits.length; i++) {
  let n = Number(digits[digits.length - 1 - i]);
  if(i % 2) { n *= 2; if(n > 9) n -= 9; }
  sum += n;
 }
 return sum % 10 === 0;
}
export function hasPersonalData(message) {
 if(typeof message !== 'string') return false;
 if(EMAIL.test(message) || NANP_PHONE.test(message) || LONG_DIGITS.test(message)) return true;
 for(const match of message.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
  const digits = match[0].replace(/\D/g, '');
  if(digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
 }
 return false;
}
export const PERSONAL_DATA_MESSAGE = 'Ne saisissez pas de courriel, de numéro de téléphone ou de numéro de carte dans votre message.';
