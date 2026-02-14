-- %% SQL: Schema
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

-- %% SQL: Seed
INSERT INTO users (id, name) VALUES (1, 'Ada');

-- %% SQL: Query
SELECT * FROM users;
