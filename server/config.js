import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  databasePath: process.env.DATABASE_PATH || './data/hallazgos.sqlite',
  appOrigin: process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
  admin: {
    name: process.env.ADMIN_NAME || 'Equipo SGC',
    email: process.env.ADMIN_EMAIL || 'admin@ofiju.local',
    password: process.env.ADMIN_PASSWORD || 'Cambiar123!'
  }
};
