import { execute } from './db';

export async function addUserTasksTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS user_tasks (
      id VARCHAR(36) PRIMARY KEY,
      message TEXT NOT NULL,
      assigned_to_email VARCHAR(255) NOT NULL,
      created_by_user_id VARCHAR(36) NULL,
      created_by_email VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_tasks_assigned_expires (assigned_to_email, expires_at),
      INDEX idx_user_tasks_created_at (created_at),
      CONSTRAINT fk_user_tasks_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON DELETE SET NULL
    )
  `);
}
