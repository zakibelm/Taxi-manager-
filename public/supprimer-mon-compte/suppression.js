(function () {
  var form = document.getElementById('form'), email = document.getElementById('email'), password = document.getElementById('password');
  var sure = document.getElementById('sure'), submit = document.getElementById('submit'), error = document.getElementById('error'), done = document.getElementById('done');
  function refresh() { submit.disabled = !(sure.checked && email.value.trim() && password.value); }
  [email, password, sure].forEach(function (el) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); });
  refresh();
  function fail(message) { error.textContent = message; error.hidden = false; submit.disabled = false; submit.textContent = 'Supprimer définitivement mon compte'; }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (submit.disabled) return;
    error.hidden = true; submit.disabled = true; submit.textContent = 'Suppression…';
    fetch('/api/account/delete', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email.value.trim(), password: password.value, confirm: true })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) return fail(data.error || 'Suppression impossible. Réessayez.');
        try { localStorage.clear(); } catch (e) { /* ignoré */ }
        form.hidden = true; done.hidden = false;
      });
    }).catch(function () { fail('Pas de connexion. Réessayez.'); });
  });
})();
