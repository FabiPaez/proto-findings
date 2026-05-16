import { db } from './db.js';
import { config } from './config.js';
import { hashPassword } from './auth.js';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(config.admin.email);

if (!existing) {
  db.prepare(`
    INSERT INTO users (name, email, password_hash, role)
    VALUES (?, ?, ?, 'admin')
  `).run(config.admin.name, config.admin.email, hashPassword(config.admin.password));
  console.log(`Admin creado: ${config.admin.email}`);
} else {
  console.log(`Admin ya existente: ${config.admin.email}`);
}
