// Applies the saved theme before the first paint (an external file, so the CSP needs no inline script).
(function applySavedTheme() {
  try {
    var savedTheme = localStorage.getItem('admin-console-theme');
    var systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : systemPrefersDark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
  } catch (error) {
    document.documentElement.dataset.theme = 'light';
  }
})();
