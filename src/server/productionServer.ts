import { SocialRepository } from './social/repository.ts';

import next from 'next';
import { Pool } from 'pg';

import { createSocketServer } from './socketServer.ts';
import { socketIdentity } from './socketAuth.ts';
import { closeAuth } from './auth.ts';
import { MatchService } from './game/service.ts';
import { FootballRepository } from './football/repository.ts';
import { PostgresMatchJournal } from './matchJournal.ts';
import { CompetitiveRepository } from './competitive/repository.ts';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid server PORT');
}

const app = next({
  dev: false,
  hostname: '0.0.0.0',
  port,
});

await app.prepare();

const handle = app.getRequestHandler();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
});

const repository = new FootballRepository(pool);
const journal = new PostgresMatchJournal(pool, 'versus');

const service = new MatchService(
  () => repository.catalog(),
  undefined,
  journal,
);

// Previous process matches cannot be resumed.
const closed = await journal.recover();
const competition = new CompetitiveRepository(pool);
await competition.recover();
const social=new SocialRepository(pool);await social.recover();

if (closed) {
  console.log(
    `Golvia closed ${closed} unfinished matches`
  );
}

const readiness = async () => {
  await pool.query('SELECT 1');
  await repository.catalog();

  if (process.env.BETTER_AUTH_URL) {
    await pool.query(
      'SELECT 1 FROM golvia_auth."user" LIMIT 1'
    );
  }

  return true;
};

const { io, httpServer } = createSocketServer(
  service,
  readiness,
  socketIdentity,
  {},
  (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error('Next.js request failed', error);

      if (!response.headersSent) {
        response.writeHead(500, {
          'Content-Type': 'text/plain',
        });
        response.end('Internal Server Error');
      } else {
        response.destroy();
      }
    });
  },
  competition,
  social,
);

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Golvia ready on port ${port}`);
  console.log('Next.js and Socket.IO initialized');
});

let stopping = false;

const shutdown = () => {
  if (stopping) return;
  stopping = true;

  io.emit('serverRestarting');

  const deadline = setTimeout(() => {
    process.exit(1);
  }, 10_000);

  deadline.unref?.();

  io.close(() => {
    void Promise.all([
      service.shutdown('server-restart'),
      pool.end(),
      closeAuth(),
    ])
      .then(() => {
        clearTimeout(deadline);
        process.exit(0);
      })
      .catch(error => {
        console.error('Shutdown failed', error);
        process.exit(1);
      });
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
