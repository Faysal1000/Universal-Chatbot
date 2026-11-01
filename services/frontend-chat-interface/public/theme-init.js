// Applies the stored theme before first paint (avoids a light/dark flash). External file so the CSP needs no inline script.
(function () {
  var stored = localStorage.getItem('chat.theme');
  var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
