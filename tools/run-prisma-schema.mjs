import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaEntryPoint = path.join(repositoryRoot, 'node_modules', 'prisma', 'build', 'index.js');
const prismaArguments = process.argv.slice(2);

if (prismaArguments.length === 0) {
  throw new Error('Pass a Prisma command, for example: db push --schema schema.prisma');
}

function runPrisma(environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaEntryPoint, ...prismaArguments], {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

function schemaConnectionUrl() {
  const directUrl = process.env.DIRECT_URL?.trim();
  const runtimeUrl = process.env.DATABASE_URL?.trim();
  const selectedUrl = directUrl || runtimeUrl;
  if (!selectedUrl) return undefined;

  const url = new URL(selectedUrl);
  if (!directUrl && url.hostname.endsWith('.neon.tech')) {
    url.hostname = url.hostname.replace('-pooler.', '.');
  }
  return url;
}

const remoteUrl = schemaConnectionUrl();
const needsWindowsNeonBridge =
  process.platform === 'win32' &&
  remoteUrl?.hostname.endsWith('.neon.tech') &&
  remoteUrl.searchParams.get('sslmode') !== 'disable';

if (!needsWindowsNeonBridge) {
  process.exitCode = await runPrisma();
} else {
  // Prisma 6's native Windows engine uses Schannel. Some Windows installations
  // cannot acquire Schannel credentials even though Node/OpenSSL can verify the
  // same server certificate. Keep the Neon hop fully verified and expose only
  // an ephemeral loopback PostgreSQL socket to the native schema engine.
  const sslRequest = Buffer.alloc(8);
  sslRequest.writeInt32BE(8, 0);
  sslRequest.writeInt32BE(80877103, 4);
  const activeSockets = new Set();

  const openVerifiedPostgresTls = () => new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: remoteUrl.hostname,
      port: Number(remoteUrl.port || 5432),
    });
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
    socket.once('error', reject);
    socket.once('connect', () => socket.write(sslRequest));
    socket.once('data', (response) => {
      if (response[0] !== 0x53) {
        socket.destroy();
        reject(new Error('The PostgreSQL server did not accept TLS.'));
        return;
      }
      const secureSocket = tls.connect({
        socket,
        servername: remoteUrl.hostname,
        rejectUnauthorized: true,
      });
      secureSocket.once('secureConnect', () => resolve(secureSocket));
      secureSocket.once('error', reject);
    });
  });

  const server = net.createServer(async (localSocket) => {
    activeSockets.add(localSocket);
    localSocket.once('close', () => activeSockets.delete(localSocket));
    try {
      const secureSocket = await openVerifiedPostgresTls();
      localSocket.pipe(secureSocket).pipe(localSocket);
    } catch (error) {
      localSocket.destroy(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not open the local Prisma TLS bridge.');

  const localUrl = new URL(remoteUrl);
  localUrl.hostname = '127.0.0.1';
  localUrl.port = String(address.port);
  localUrl.searchParams.set('sslmode', 'disable');
  localUrl.searchParams.delete('channel_binding');

  try {
    process.exitCode = await runPrisma({
      ...process.env,
      DATABASE_URL: localUrl.toString(),
      DIRECT_URL: localUrl.toString(),
    });
  } finally {
    for (const socket of activeSockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}
