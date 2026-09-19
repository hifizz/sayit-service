import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const template=await readFile('.env.example','utf8');
try{await writeFile('.env',template.replace('GENERATE_WITH_NPM_RUN_SETUP',randomBytes(32).toString('hex')),{flag:'wx',mode:0o600});console.log('Created .env (0600). Mock mode is text-only and does not claim transcription quality.');}
catch(e){if(e.code==='EEXIST')console.log('.env already exists; left unchanged.');else throw e;}
