// Applies the saved theme before first paint (no flash of the wrong theme). Kept external for CSP.
(function () {
  try {
    var t = localStorage.getItem('sat-theme');
    var dark =
      t === 'dark' || ((t === null || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    /* storage unavailable: fall back to light */
  }
})();
