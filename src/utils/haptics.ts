export function triggerHaptic(type: 'light' | 'medium' | 'success' | 'warning' = 'light') {
  try {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      if (type === 'light') navigator.vibrate(8);
      else if (type === 'medium') navigator.vibrate(15);
      else if (type === 'success') navigator.vibrate([10, 30, 15]);
      else if (type === 'warning') navigator.vibrate([20, 40, 20]);
    }
  } catch {
    // Graceful fallback when vibrate is unsupported or restricted
  }
}
