// USB link to the headband (Web Serial API, 115200 baud, newline-separated text).
class HeadbandSerial {
  constructor({ onLine, onState }) {
    this.onLine = onLine;
    this.onState = onState;
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.connected = false;
    if (this.supported) {
      navigator.serial.addEventListener('disconnect', (e) => { if (e.target === this.port) this._closed(); });
      navigator.serial.addEventListener('connect', () => { if (!this.connected) this.autoConnect(); });
    }
  }

  get supported() { return 'serial' in navigator; }

  // Reconnect to a headband the user already approved once.
  async autoConnect() {
    if (!this.supported || this.connected) return false;
    const ports = await navigator.serial.getPorts();
    if (!ports.length) return false;
    return this.open(ports[0]);
  }

  async request() {
    const port = await navigator.serial.requestPort();
    return this.open(port);
  }

  async open(port) {
    try {
      await port.open({ baudRate: 115200 });
    } catch (e) {
      if (!String(e).includes('already open')) throw e;
    }
    this.port = port;
    this.writer = port.writable.getWriter();
    this.connected = true;
    this.onState(true);
    this._readLoop();
    return true;
  }

  async _readLoop() {
    const decoder = new TextDecoderStream();
    this._pipe = this.port.readable.pipeTo(decoder.writable).catch(() => {});
    this.reader = decoder.readable.getReader();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (line) this.onLine(line);
        }
      }
    } catch (e) {
      /* device unplugged */
    } finally {
      this._closed();
    }
  }

  async write(line) {
    if (!this.writer) return;
    try { await this.writer.write(new TextEncoder().encode(line + '\n')); } catch (e) { /* ignore */ }
  }

  async close() {
    try {
      if (this.reader) await this.reader.cancel();
      if (this._pipe) await this._pipe;
      if (this.writer) this.writer.releaseLock();
      if (this.port) await this.port.close();
    } catch (e) { /* ignore */ }
    this._closed();
  }

  _closed() {
    if (!this.connected) return;
    this.connected = false;
    this.writer = null;
    this.onState(false);
  }
}
