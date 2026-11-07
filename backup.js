const Database=require('better-sqlite3');
const path=require('node:path');const fs=require('node:fs');
const dir=process.env.DATA_DIR||path.join(__dirname,'data');
const source=path.join(dir,'grimz.sqlite');
if(!fs.existsSync(source)){console.error('Datenbank nicht gefunden:',source);process.exit(1)}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const db=new Database(source);
db.backup(path.join(dir,`grimz-backup-${stamp}.sqlite`)).then(()=>{console.log('Backup erstellt.');db.close()}).catch(e=>{console.error(e);db.close();process.exit(1)});
