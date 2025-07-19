const keys = require('./keys');

// Express App Setup
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Logging env vars
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
  ssl: process.env.NODE_ENV !== 'production' ? false : { rejectUnauthorized: false },
});

pgClient.on('connect', (client) => {
  console.log('✅ Connected to Postgres. Ensuring table...');
  client
    .query('CREATE TABLE IF NOT EXISTS values (number INT)')
    .then(() => console.log('✅ Table `values` ready'))
    .catch((err) => console.error('PG INIT ERROR:', err));
});

// Redis Client Setup
const redis = require('redis');

let isRedisConnected = false;
let isRedisPublisherConnected = false;

const redisClient = redis.createClient({
  socket: {
    host: keys.redisHost,
    port: keys.redisPort,
    tls: true
  },
});

redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error', err);
});

const redisPublisher = redisClient.duplicate();

(async () => {
  try {
    console.log('🔍 Attempting Redis connection to:', keys.redisHost, keys.redisPort);
    await redisClient.connect();
    isRedisConnected = true;
    console.log('✅ Redis client connected');

    await redisPublisher.connect();
    isRedisPublisherConnected = true;
    console.log('✅ Redis publisher connected');
  } catch (err) {
    console.error('❌ Redis connection failed:', err);
  }
})();

// --- Routes ---

app.get('/', (req, res) => {
  res.send('Hi');
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
    console.error('❌ Postgres fetch error:', err);
    res.status(500).send('Error fetching values from Postgres');
  }
});

app.get('/api/values/current', async (req, res) => {
  if (!isRedisConnected) {
    console.error('❌ Redis not connected for GET /current');
    return res.status(503).send('Redis not connected');
  }

  try {
    const values = await redisClient.hGetAll('values');
    res.send(values);
  } catch (err) {
    console.error('❌ Redis fetch error:', err);
    res.status(500).send('Error fetching current values');
  }
});

app.get('/api/pg-test', async (req, res) => {
  try {
    const result = await pgClient.query('SELECT NOW()');
    res.send(result.rows);
  } catch (err) {
    console.error('❌ PG test failed:', err);
    res.status(500).send('Postgres test failed');
  }
});

app.get('/api/redis-test', async (req, res) => {
  if (!isRedisConnected) {
    console.error('❌ Redis not connected for redis-test');
    return res.status(503).send('Redis not connected');
  }

  try {
    await redisClient.hSet('values', 'debug', 'ok');
    const data = await redisClient.hGetAll('values');
    res.send(data);
  } catch (err) {
    console.error('❌ Redis test failed:', err);
    res.status(500).send('Redis test failed');
  }
});

app.get('/api/health', (req, res) => {
  res.send({
    redis: isRedisConnected,
    redisPublisher: isRedisPublisherConnected,
    postgres: true,
    status: 'OK',
  });
});

app.post('/api/values', async (req, res) => {
  const index = req.body.index;
  console.log('📥 Received index:', index);

  if (parseInt(index) > 40) {
    console.log('❌ Index too high:', index);
    return res.status(422).send('Index too high');
  }

  if (!isRedisConnected || !isRedisPublisherConnected) {
    console.error('❌ Redis not connected for POST /values');
    return res.status(503).send('Redis not connected');
  }

  try {
    console.log('🔁 Writing placeholder to Redis...');
    await redisClient.hSet('values', index, 'Nothing yet!');

    console.log('📢 Publishing to Redis...');
    await redisPublisher.publish('insert', index);

    console.log('📝 Writing to Postgres...');
    await pgClient.query('INSERT INTO values(number) VALUES($1)', [index]);

    console.log('✅ All done for index', index);
    res.send({ working: true });
  } catch (err) {
    console.error('🔥 POST /api/values error:', err);
    res.status(500).send('Error processing the value');
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('🚀 Listening on port 5000');
});
