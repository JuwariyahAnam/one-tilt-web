// Practice page behaviour (runs before the overlay scripts).
let windowId = null;
chrome.windows.getCurrent((w) => { windowId = w && w.id; });

document.getElementById('openPanel').addEventListener('click', () => {
  // Must be called straight from the click (Chrome requires a user gesture).
  chrome.sidePanel.open({ windowId }).catch(() => {
    alert('Click the One-Tilt icon in the toolbar to open the side panel.');
  });
});

document.getElementById('booking').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const name = f.get('name') || 'Guest';
  const doctor = f.get('doctor') || 'the next available doctor';
  const day = (f.get('day') || 'soon').toLowerCase();
  const time = (f.get('time') || 'any time').toLowerCase();
  const done = document.getElementById('done');
  done.hidden = false;
  done.textContent = `Booked! ${name}, you will see ${doctor} ${day} (${time}).${f.get('sms') ? ' An SMS reminder is on its way.' : ''}`;
});
