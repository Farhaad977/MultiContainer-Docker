const keys = require('./keys');
const { createClient } = require('redis');

const redisClient = createClient({
  socket: {
    host: keys.redisHost,
    port: keys.redisPort,
  },
  // retry_strategy replaced by built-in reconnect in v4
});

redisClient.on('error', (err) => {
  console.error('Redis client error:', err);
});

const sub = redisClient.duplicate();

async function start() {
  await redisClient.connect();
  await sub.connect();

  await sub.subscribe('insert', async (message) => {
    console.log(`Received message on channel insert: ${message}`);

    const index = parseInt(message);

    function fib(n) {
      if (n < 2) return 1;
      return fib(n - 1) + fib(n - 2);
    }

    const result = fib(index);

    try {
      await redisClient.hSet('values', message, result.toString());
      console.log(`Set fib(${message}) = ${result} in Redis`);
    } catch (err) {
      console.error('Error setting value in Redis:', err);
    }
  });
}

start().catch((err) => {
  console.error('Error in Redis subscription:', err);
});
