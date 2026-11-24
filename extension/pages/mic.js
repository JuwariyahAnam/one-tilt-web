document.getElementById('allow').addEventListener('click', async () => {
  const msg = document.getElementById('msg');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Done! Voice commands are ready. You can close this tab.';
    msg.style.color = '#15803d';
  } catch (e) {
    msg.textContent = 'Permission was blocked. Click the lock icon in the address bar and allow the microphone.';
    msg.style.color = '#c0392b';
  }
});
