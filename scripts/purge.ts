import 'dotenv/config';
import {createStorage} from '../src/storage/index.js';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const storage=createStorage(process.env.DATABASE_URL,Number(process.env.RETENTION_HOURS??168));
try{console.log(JSON.stringify({deleted_dictations:await storage.purgeExpired()}));}finally{await storage.close();}
