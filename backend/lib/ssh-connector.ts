import { Client, ClientChannel } from 'ssh2';
import { StringDecoder } from 'string_decoder';

export type SshTarget = {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  defaultCwd?: string;
};

export type SshConnectorParams = {
  target: SshTarget;
  cols: number;
  rows: number;
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
  onStatus: (message: string) => void;
  onOutput: (data: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export class SshConnector {
  private readonly conn = new Client();
  private readonly stdoutDecoder = new StringDecoder('utf8');
  private readonly stderrDecoder = new StringDecoder('utf8');
  private stream: ClientChannel | null = null;
  private closed = false;
  private cols: number;
  private rows: number;

  constructor(private readonly params: SshConnectorParams) {
    this.cols = params.cols;
    this.rows = params.rows;
  }

  connect() {
    const { target } = this.params;

    this.conn
      .on('ready', () => {
        this.params.onStatus(`SSH connected: ${target.name}`);
        this.openShell();
      })
      .on('error', (err) => {
        this.params.onError(`SSH error: ${err.message}`);
        this.close();
      })
      .on('close', () => {
        this.closed = true;
        this.params.onClose();
      });

    this.conn.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      keepaliveInterval: this.params.keepaliveIntervalMs,
      keepaliveCountMax: this.params.keepaliveCountMax,
    });
  }

  write(data: string) {
    if (!this.closed && this.stream?.writable) {
      this.stream.write(data);
    }
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;

    try {
      if (!this.closed && this.stream) {
        this.stream.setWindow(rows, cols, 480, 640);
      }
    } catch {}
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    try {
      this.stream?.close();
    } catch {}
    try {
      this.conn.end();
    } catch {}
  }

  private openShell() {
    this.conn.shell(
      {
        term: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
      },
      (err, channel) => {
        if (err) {
          this.params.onError(`Open shell failed: ${err.message}`);
          this.close();
          return;
        }

        this.stream = channel;

        if (this.params.target.defaultCwd) {
          this.stream.write(`cd ${escapeShellArg(this.params.target.defaultCwd)} && clear\n`);
        }

        this.stream.on('data', (chunk: Buffer) => {
          this.forwardDecodedOutput(this.stdoutDecoder, chunk);
        });

        this.stream.stderr?.on('data', (chunk: Buffer) => {
          this.forwardDecodedOutput(this.stderrDecoder, chunk);
        });

        this.stream.on('close', () => {
          this.flushDecodedOutput();
          this.params.onStatus('Shell closed');
          this.close();
        });
      }
    );
  }

  private forwardDecodedOutput(decoder: StringDecoder, chunk: Buffer) {
    const data = decoder.write(chunk);
    if (data) {
      this.params.onOutput(data);
    }
  }

  private flushDecodedOutput() {
    const stdout = this.stdoutDecoder.end();
    if (stdout) {
      this.params.onOutput(stdout);
    }

    const stderr = this.stderrDecoder.end();
    if (stderr) {
      this.params.onOutput(stderr);
    }
  }
}

function escapeShellArg(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
