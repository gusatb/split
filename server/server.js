import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const clientDistPath = path.resolve(__dirname, '../client/dist');

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'split-api',
  });
});

app.use(express.static(clientDistPath));

app.get(/^(?!\/api).*/, (_req, res, next) => {
  const indexPath = path.join(clientDistPath, 'index.html');

  if (!existsSync(indexPath)) {
    return next();
  }

  return res.sendFile(indexPath);
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
