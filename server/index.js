const keys = require('./keys');

// Express App Setup
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Print env keys for verification
console.log('ENVIRONMENT VARIABLES:', {
  PGHOST: process.env.PGHOST,
  PGUSER: process.env.PGUSER,
  PGPASSWORD: process.env.PGPASSWORD,
  PGDATABASE: process.env.PGDATABASE,
  PGPORT: process.env.PGPORT,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
});

// Postgres Client Setup
const { Pool } = require('pg');
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  ssl:
    process.env.NODE_ENV !== 'production'
      ? false
      : { rejectUnauthorized: false },
});

pgClient.on('connect', (client) => {
  client
    .query('CREATE TABLE IF NOT EXISTS values (number INT)')
    .catch((err) => console.error('PG INIT ERROR:', err));
});

// Redis Client Setup
const redis = require('redis');
const redisClient = redis.createClient({
  socket: {
    host: keys.redisHost,
    port: keys.redisPort,
  },
});

const redisPublisher = redisClient.duplicate();

(async () => {
  try {
    await redisClient.connect();
    await redisPublisher.connect();
    console.log('Connected to Redis successfully.');
  } catch (err) {
    console.error('Redis connection failed:', err);
  }
})();

// --- Express Routes ---

app.get('/', (req, res) => {
  res.send('Hi');
});

app.get('/api/test', (req, res) => {
  res.send('Server is running!');
});

app.get('/api/env-check', (req, res) => {
  res.send({
    PGHOST: process.env.PGHOST,
    PGUSER: process.env.PGUSER,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
  });
});

app.get('/api/values/all', async (req, res) => {
  try {
    const values = await pgClient.query('SELECT * from values');
    res.send(values.rows);
  } catch (err) {
    console.error('Postgres fetch error:', err);
    res.status(500).send('Error fetching values from Postgres');
  }
});

app.get('/api/values/current', async (req, res) => {
  try {
    const values = await redisClient.hGetAll('values');
    res.send(values);
  } catch (err) {
    console.error('Redis fetch error:', err);
    res.status(500).send('Error fetching current values');
  }
});

app.post('/api/values', async (req, res) => {
  const index = req.body.index;

  if (parseInt(index) > 40) {
    return res.status(422).send('Index too high');
  }

  try {
    await redisClient.hSet('values', index, 'Nothing yet!');
    await redisPublisher.publish('insert', index);
    await pgClient.query('INSERT INTO values(number) VALUES($1)', [index]);
    res.send({ working: true });
  } catch (err) {
    console.error('POST /api/values error:', err);
    res.status(500).send('Error processing the value');
  }
});

// Start Express server
app.listen(5000, '0.0.0.0', () => {
  console.log('Listening on port 5000');
});
