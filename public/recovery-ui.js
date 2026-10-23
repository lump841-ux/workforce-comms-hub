(() => {
  const form = document.getElementById('recovery') || document.getElementById('reset');
  const result = document.getElementById('result');
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  const reset = form.id === 'reset';
  if (reset && !/^[a-f0-9]{64}$/.test(token)) {
    result.textContent = 'This recovery link is missing or invalid. Request a new link.';
    form.querySelector('button').disabled = true;
    return;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (reset && document.getElementById('password').value !== document.getElementById('confirm').value) {
      result.textContent = 'Passwords do not match.'; return;
    }
    const button = form.querySelector('button'); button.disabled = true; result.textContent = 'Please wait…';
    try {
      const body = reset ? {token,password:document.getElementById('password').value} : {email:document.getElementById('email').value};
      const response = await fetch('/api/auth/'+(reset?'reset-password':'forgot-password'), {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Twanova-CSRF':'1'},body:JSON.stringify(body)});
      const data = await response.json();
      result.textContent = response.ok ? data.message : (data.error || 'Unable to complete request. Please try again.');
      if (response.ok && reset) { form.reset(); form.hidden = true; }
    } catch { result.textContent = 'Connection interrupted. Please try again.'; }
    finally { button.disabled = false; }
  });
})();
