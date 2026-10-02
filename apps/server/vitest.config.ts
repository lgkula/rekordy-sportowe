import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // DB integration tests share TEST_DB_NAME (one of them drops all tables), so run files
    // one at a time.
    fileParallelism: false,
  },
});
