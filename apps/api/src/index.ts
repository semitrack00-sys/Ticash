import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const [{ createApp }, { connectDatabase, databaseEnabled }] = await Promise.all([
  import('./app.js'),
  import('./database.js'),
]);

const port = Number.parseInt(process.env.PORT ?? '4000', 10);
await connectDatabase();
createApp().listen(port, () => {
  console.log(`TiCash API listening on ${port} (${databaseEnabled ? 'postgresql' : 'memory'} mode)`);
});
