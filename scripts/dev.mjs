import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const certDir = path.resolve(process.cwd(), '.certs');
const keyPath = path.resolve(
  process.env.WEBTERMINAL_HTTPS_KEY || path.join(certDir, 'webterminal-dev-key.pem')
);
const certPath = path.resolve(
  process.env.WEBTERMINAL_HTTPS_CERT || path.join(certDir, 'webterminal-dev-cert.pem')
);

ensureDevCertificate(keyPath, certPath);

const child = spawn(process.execPath, ['--import', 'tsx', 'backend/server.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WEBTERMINAL_HTTPS_KEY: keyPath,
    WEBTERMINAL_HTTPS_CERT: certPath,
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal === 'SIGINT') process.exit(130);
  if (signal === 'SIGTERM') process.exit(143);
  process.exit(code ?? 1);
});

function ensureDevCertificate(keyFile, certFile) {
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return;
  }

  assertOpenSsl();
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.mkdirSync(path.dirname(certFile), { recursive: true });
  fs.mkdirSync(certDir, { recursive: true });

  const configPath = path.join(certDir, 'webterminal-dev-openssl.cnf');
  fs.writeFileSync(configPath, createOpenSslConfig(), 'utf-8');

  console.log(`> Generating self-signed dev certificate: ${certFile}`);
  const result = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '825',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-subj',
      '/CN=webterminal-dev',
      '-config',
      configPath,
      '-extensions',
      'v3_req',
    ],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertOpenSsl() {
  const result = spawnSync('openssl', ['version'], { stdio: 'ignore' });
  if (result.error) {
    throw new Error('openssl is required to generate the development HTTPS certificate.');
  }
}

function createOpenSslConfig() {
  const { dnsNames, ipAddresses } = collectSubjectAltNames();
  const altNames = [
    ...dnsNames.map((name, index) => `DNS.${index + 1} = ${name}`),
    ...ipAddresses.map((address, index) => `IP.${index + 1} = ${address}`),
  ].join('\n');

  return `[req]
distinguished_name = dn
prompt = no

[dn]
CN = webterminal-dev

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames}
`;
}

function collectSubjectAltNames() {
  const dnsNames = new Set(['localhost']);
  const ipAddresses = new Set(['127.0.0.1', '::1']);

  addHost(os.hostname(), dnsNames, ipAddresses);
  addHost(process.env.WEBTERMINAL_HOSTNAME, dnsNames, ipAddresses);

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const item of addresses || []) {
      if (!item.internal && !item.address.includes('%')) {
        addHost(item.address, dnsNames, ipAddresses);
      }
    }
  }

  const hostname = os.hostname();
  if (hostname && !hostname.includes('.')) {
    addHost(`${hostname}.local`, dnsNames, ipAddresses);
  }

  return {
    dnsNames: [...dnsNames],
    ipAddresses: [...ipAddresses],
  };
}

function addHost(value, dnsNames, ipAddresses) {
  const host = String(value || '').trim();
  if (!host || host === '0.0.0.0' || host === '::') return;

  const ipVersion = net.isIP(host);
  if (ipVersion) {
    ipAddresses.add(host);
    return;
  }

  if (/^[a-z0-9.-]+$/i.test(host)) {
    dnsNames.add(host);
  }
}
