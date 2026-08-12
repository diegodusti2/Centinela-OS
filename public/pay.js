(() => {
  const form = document.querySelector('#registration-form');
  const status = document.querySelector('#status');
  const button = form.querySelector('button');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = 'Enviando solicitud…';
    const data = Object.fromEntries(new FormData(form).entries());
    data.plan = Number(data.plan);
    delete data.consent;
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo enviar la solicitud');
      status.textContent = `Solicitud #${body.registrationId} recibida. Revisa tu correo para continuar con el pago autorizado.`;
      form.reset();
    } catch (error) {
      status.textContent = error.message;
      status.style.color = '#fca5a5';
    } finally {
      button.disabled = false;
    }
  });
})();
