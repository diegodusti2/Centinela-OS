(() => {
  const step1 = document.querySelector('#step1');
  const step2 = document.querySelector('#step2');
  const done = document.querySelector('#done');
  const status1 = document.querySelector('#status1');
  const status2 = document.querySelector('#status2');
  const verifyForm = document.querySelector('#verify-form');
  const passwordForm = document.querySelector('#password-form');
  let resetToken = '';

  function showError(el, message) {
    el.textContent = message;
    el.style.color = '#b91c1c';
  }

  function showOk(el, message) {
    el.textContent = message;
    el.style.color = '#059669';
  }

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = verifyForm.querySelector('button');
    button.disabled = true;
    status1.textContent = '';
    const data = Object.fromEntries(new FormData(verifyForm).entries());
    try {
      const response = await fetch('/api/auth/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo verificar la identidad');
      resetToken = body.resetToken;
      step1.hidden = true;
      step2.hidden = false;
    } catch (error) {
      showError(status1, error.message);
    } finally {
      button.disabled = false;
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = passwordForm.querySelector('button');
    const data = Object.fromEntries(new FormData(passwordForm).entries());
    if (data.newPassword !== data.confirm) {
      showError(status2, 'Las contraseñas no coinciden.');
      return;
    }
    button.disabled = true;
    status2.textContent = '';
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword: data.newPassword }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo actualizar la contraseña');
      step2.hidden = true;
      done.hidden = false;
    } catch (error) {
      showError(status2, error.message);
    } finally {
      button.disabled = false;
    }
  });
})();