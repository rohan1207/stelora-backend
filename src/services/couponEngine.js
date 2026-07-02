export function generateCouponCode(displayName, productName) {
  const namePart = displayName
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 6)
    .toUpperCase() || "CREATOR";
  const suffix = Math.floor(10 + Math.random() * 89);
  return `${namePart}${suffix}`;
}

export function validateCodeFormat(code) {
  return /^[A-Z0-9]{4,20}$/.test(code);
}
