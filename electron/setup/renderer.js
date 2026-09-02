const statusEl = document.getElementById('status');
const existingPanel = document.getElementById('existing-panel');
const embeddedPanel = document.getElementById('embedded-panel');
const tabs = document.querySelectorAll('.tab');
const submitExistingEl = document.getElementById('submit-existing');
const submitEmbeddedEl = document.getElementById('submit-embedded');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind ?? '';
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    existingPanel.hidden = mode !== 'existing';
    embeddedPanel.hidden = mode !== 'embedded';
    setStatus('');
  });
});

submitExistingEl.addEventListener('click', async () => {
  submitExistingEl.disabled = true;
  setStatus('Connecting…');

  const config = {
    host: document.getElementById('host').value.trim(),
    port: Number(document.getElementById('port').value),
    database: document.getElementById('database').value.trim(),
    user: document.getElementById('user').value.trim(),
    password: document.getElementById('password').value,
  };

  const result = await window.setupBridge.connect(config);

  if (result.ok) {
    setStatus('Connected. Setting up the database…', 'ok');
  } else {
    setStatus(result.error, 'error');
    submitExistingEl.disabled = false;
  }
});

submitEmbeddedEl.addEventListener('click', async () => {
  submitEmbeddedEl.disabled = true;
  setStatus('Setting up PostgreSQL — this may take a moment…');

  const result = await window.setupBridge.provisionEmbedded();

  if (result.ok) {
    setStatus('PostgreSQL is ready. Setting up the database…', 'ok');
  } else {
    setStatus(result.error, 'error');
    submitEmbeddedEl.disabled = false;
  }
});
